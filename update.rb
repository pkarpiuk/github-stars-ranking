#!/usr/bin/env ruby

# Jednorazowe odświeżenie rankingu repozytoriów GitHuba wg gwiazdek (dla GitHub Actions; bez serwera i bez pętli).
# Dane pobierane są wprost z GitHub GraphQL API (wymaga GITHUB_TOKEN), po kilkadziesiąt repozytoriów na zapytanie,
# razem ze wszystkimi polami używanymi w UI.
#
#   GITHUB_TOKEN=... ruby update.rb [--force]
#
# Wejście/wyjście (ścieżki względne do bieżącego katalogu; zmienne środowiskowe w nawiasach):
#   data/ranking-db.json      historia snapshotów (JSON-lines {ts, data}), tylko do dopisywania (RANKING_DB); w Actions: gałąź `data`
#   data/language_colors.json odświeżany słownik kolorów języków (RANKING_LANG_COLORS); zapas: language_colors.json z repozytorium
#   _site/db.js               dane dla strony (OUTPUT_DB_JS); workflow dokłada do tego katalogu pliki ze site/ i publikuje na Pages
#
# Bramka świeżości: jeśli ostatni snapshot w historii ma mniej niż MIN_INTERVAL sekund (domyślnie 6 dni; zapas na opóźnienia
# harmonogramu przy cotygodniowym uruchamianiu), nic nie pobieramy ani nie zapisujemy (wyjście "updated=false"); --force pomija bramkę.
# Kody wyjścia: 0 – sukces albo pominięcie (decyduje `updated` w $GITHUB_OUTPUT), 1 – błąd (nic nie zapisano), 2 – zły parametr.

require 'json'
require 'net/http'
require 'uri'
require 'date'
require 'openssl'
require 'logger'
require 'fileutils'
require_relative 'compare_snapshots'
require_relative 'language_colors'

$RANKING_PATH = ENV['RANKING_DB'] || 'data/ranking-db.json'
$DB_JS_PATH   = ENV['OUTPUT_DB_JS'] || '_site/db.js'
$TOKEN        = ENV['GITHUB_TOKEN']
$RANKING_SIZE = (ENV['RANKING_SIZE'] || 10000).to_i
$MIN_INTERVAL = (ENV['MIN_INTERVAL'] || 6 * 24 * 3600).to_i      # min. odstęp od poprzedniego snapshotu (sekundy)
$PAGE_SIZE    = (ENV['PAGE_SIZE'] || 50).to_i     # zmniejszany automatycznie, gdy GitHub zwraca 502
$MIN_PAGE_SIZE = 10
$MIN_STARS    = (ENV['MIN_STARS'] || 1000).to_i   # dolna granica gwiazdek – zawęża zbiór przeszukiwany przez GitHub
$SEARCH_LIMIT = 1000   # GitHub zwraca maks. 1000 wyników na jedno wyszukiwanie
$GRAPHQL_URI  = URI(ENV['GITHUB_GRAPHQL_URL'] || 'https://api.github.com/graphql')   # zmienna tylko do testów na atrapie API
$LANG_COLORS_PATH = File.join( __dir__, 'language_colors.json' )   # nazwa języka => kolor: kopia startowa (repozytorium)
$LANG_COLORS_DATA_PATH = ENV['RANKING_LANG_COLORS'] || 'data/language_colors.json'   # kopia odświeżana przy każdym pobraniu (gałąź data)

$log = Logger.new( STDERR )
$log.formatter = proc { |sev, time, _prog, msg| "[#{time.strftime('%Y-%m-%d %H:%M:%S')}] #{sev.ljust(5)} #{msg}\n" }

QUERY = <<~GRAPHQL
  query($q: String!, $after: String, $first: Int!) {
    search(query: $q, type: REPOSITORY, first: $first, after: $after) {
      pageInfo { hasNextPage endCursor }
      nodes {
        ... on Repository {
          databaseId
          nameWithOwner
          url
          description
          createdAt
          stargazerCount
          forkCount
          primaryLanguage { name }
          watchers { totalCount }
          owner { avatarUrl }
          repositoryTopics(first: 30) { nodes { topic { name } } }
        }
      }
    }
    rateLimit { remaining resetAt }
  }
GRAPHQL

class RetryError < StandardError
  attr_reader :delay
  def initialize(msg, delay = nil)
    super( msg )
    @delay = delay
  end
end

# Jedno zapytanie GraphQL, z ponawianiem przy błędach przejściowych (502/timeouty wyszukiwarki).
TRANSIENT = [RetryError, Timeout::Error, SystemCallError, SocketError, OpenSSL::SSL::SSLError, JSON::ParserError]

def graphql(variables, max_attempts = 8)
  attempts = 0
  begin
    attempts += 1
    http = Net::HTTP.new($GRAPHQL_URI.host, $GRAPHQL_URI.port)
    http.use_ssl = ( $GRAPHQL_URI.scheme == 'https' )
    http.open_timeout = 30
    http.read_timeout = 90
    req = Net::HTTP::Post.new($GRAPHQL_URI.request_uri)
    req['Authorization'] = "Bearer #{$TOKEN}"
    req['Content-Type'] = 'application/json'
    req['User-Agent'] = 'github-stars-ranking'
    req.body = JSON.generate( { 'query' => QUERY, 'variables' => variables } )
    res = http.request( req )

    if res.code == '401' then
      raise 'Nieprawidłowy GITHUB_TOKEN (HTTP 401)'
    end
    if res.code == '403' || res.code == '429' then
      wait = (res['retry-after'] || 60).to_i
      raise RetryError.new( "limit zapytań (HTTP #{res.code})", wait )
    end
    raise RetryError, "HTTP #{res.code}" unless res.code == '200'

    json = JSON.parse( res.body )
    if json['errors'] && !json['data'] then
      raise RetryError, json['errors'].map { |e| e['message'] }.join('; ')
    end
    json
  rescue *TRANSIENT => e
    raise if attempts >= max_attempts
    delay = (e.respond_to?(:delay) && e.delay) || [5 * 2**(attempts - 1), 300].min
    $log.warn "Błąd zapytania (#{e.message}), próba #{attempts}/#{max_attempts}, ponawiam za #{delay}s"
    sleep delay
    retry
  end
end

# Zwraca listę rekordów repozytoriów posortowaną malejąco wg gwiazdek.
# Wyszukiwanie ma limit 1000 wyników, więc po wyczerpaniu strony zawężamy zakres gwiazdek
# do wartości ostatniego (najmniejszego) wyniku i szukamy dalej; duplikaty na granicy usuwamy.
def fetchRanking(size)
  repos = {}  # nameWithOwner => rekord
  max_stars = nil
  page = $PAGE_SIZE
  while repos.size < size do
    q = "stars:#{max_stars ? "#{$MIN_STARS}..#{max_stars}" : ">=#{$MIN_STARS}"} sort:stars-desc"
    after = nil
    fetched_in_slice = 0
    last_stars = nil
    new_in_slice = 0
    while fetched_in_slice < $SEARCH_LIMIT && repos.size < size do
      begin
        json = graphql( { 'q' => q, 'after' => after, 'first' => page }, page > $MIN_PAGE_SIZE ? 2 : 8 )
      rescue *TRANSIENT => e
        raise if page <= $MIN_PAGE_SIZE
        page = [page / 2, $MIN_PAGE_SIZE].max
        $log.warn "Zapytanie zbyt ciężkie (#{e.message}), zmniejszam stronę do #{page}"
        retry
      end
      search = json['data']['search']
      search['nodes'].each do |n|
        next if n.nil? || n['nameWithOwner'].nil?
        last_stars = n['stargazerCount']
        fetched_in_slice += 1
        unless repos.has_key?( n['nameWithOwner'] ) then
          repos[n['nameWithOwner']] = n
          new_in_slice += 1
        end
      end
      rl = json['data']['rateLimit']
      $log.info "FETCH #{repos.size}/#{size} (limit: #{rl['remaining']} pozostało)"
      break unless search['pageInfo']['hasNextPage']
      after = search['pageInfo']['endCursor']
    end
    break if last_stars.nil?                # brak wyników – koniec rankingu
    if new_in_slice == 0 then                # wszystkie z tej samej liczby gwiazdek – nie ma jak iść dalej
      $log.warn "Brak nowych wyników przy stars<=#{last_stars}, kończę"
      break
    end
    max_stars = last_stars
    sleep 2                                  # dla ostrożności wobec secondary rate limit
  end
  repos.values.sort_by { |n| -n['stargazerCount'] }.first( size )
end

# Dopisuje snapshot do historii. Wpisy to [nazwa, gwiazdki, databaseId]; id (stały mimo zmian nazwy) służy do porównań
# między snapshotami (compare_snapshots.rb).
def saveRanking(pairs, ts, ids = nil)
  FileUtils.mkdir_p( File.dirname( $RANKING_PATH ) )
  data = ids ? pairs.each_with_index.map { |( name, stars ), i| [name, stars, ids[i]] } : pairs
  File.open( $RANKING_PATH, 'a' ) do |f|
    f.puts( JSON.generate( { 'ts' => ts, 'data' => data } ) )
  end
end

# Słownik kolorów: odświeżona kopia z data/, a gdy jej nie ma albo jest uszkodzona – kopia startowa z repozytorium.
def loadLanguageColors
  [$LANG_COLORS_DATA_PATH, $LANG_COLORS_PATH].each do |p|
    next unless File.exist?( p )
    h = ( JSON.parse( File.read( p ) ) rescue nil )
    return h if h.is_a?( Hash ) && !h.empty?
  end
  {}
end

# Format zgodny z main.js: RANKING = [['/owner/name', stars], ...], REPOS['/owner/name'] = {...}
def generateJS( fpath, nodes, ts )
  ranking = nodes.map { |n| ["/#{n['nameWithOwner']}", n['stargazerCount']] }
  repos = {}
  nodes.each do |n|
    repos["/#{n['nameWithOwner']}"] = {
      'full_name'         => n['nameWithOwner'],
      'description'       => n['description'],
      'language'          => n['primaryLanguage'] && n['primaryLanguage']['name'],
      'created_at'        => n['createdAt'],
      'forks_count'       => n['forkCount'],
      'subscribers_count' => n['watchers']['totalCount'],
      'topics'            => n['repositoryTopics']['nodes'].map { |t| t['topic']['name'] },
      'avatar_url'        => n['owner'] && n['owner']['avatarUrl'],
      'html_url'          => n['url']
    }
  end
  ids = nodes.map { |n| n['databaseId'] }
  writeDbJs( fpath, ranking, repos, ts, ids )
  [ranking, ids]
end

# Zapisuje db.js: RANKING (bieżący ranking), RANKING_TS (jego data), COMPARE (snapshoty do porównania z historii
# w $RANKING_PATH, starsze od ts; patrz compare_snapshots.rb), LANG_COLORS i REPOS (metadane). Zapis atomowy.
def writeDbJs( fpath, ranking, repos, ts, ids = nil )
  compare = CompareSnapshots.build( ranking, ts, $RANKING_PATH, ids )
  all_colors = loadLanguageColors
  langs = repos.each_value.map { |r| r['language'] }.compact.uniq
  lang_colors = langs.sort.to_h { |l| [l, all_colors[l]] }.compact   # tylko języki występujące w danych i mające kolor
  $log.info "Porównania: #{compare.size} snapshotów (#{compare.map { |c| c['label'] }.join( ', ' )})"
  FileUtils.mkdir_p( File.dirname( fpath ) )
  tmp = "#{fpath}.tmp"
  File.open( tmp, 'w' ) do |f|
    f.write( 'var RANKING = ' )
    f.write( JSON.generate( ranking ) )
    f.puts( ';' )
    f.puts( "var RANKING_TS = #{JSON.generate( ts )};" )   # data aktualności rankingu, pokazywana w belce
    f.puts( "var COMPARE = #{JSON.generate( compare )};" ) # snapshoty do porównania (kolumna Change, lista "Compare to")
    f.puts( "var LANG_COLORS = #{JSON.generate( lang_colors )};" )  # kolorowa kropka przy języku w tabeli
    f.write( 'var REPOS = ' )
    f.write( JSON.generate( repos ) )
    f.puts( ';' )
  end
  File.rename( tmp, fpath )
end

# Czas ostatniego snapshotu w historii (znacznik ts z ostatniego niepustego wiersza) albo nil, gdy historii nie ma.
def lastSnapshotTime
  return nil unless File.exist?( $RANKING_PATH )
  last = nil
  File.foreach( $RANKING_PATH ) { |l| last = l unless l.strip.empty? }
  return nil unless last
  ts = last[/\A\{"ts":"([^"]+)"/, 1]
  ts && DateTime.parse( ts ).to_time
rescue StandardError => e
  $log.warn "Nie można odczytać daty ostatniego snapshotu z #{$RANKING_PATH} (#{e.message}) – traktuję historię jako nieaktualną"
  nil
end

# Wyjście dla GitHub Actions: pary klucz=wartość dopisywane do pliku wskazanego przez $GITHUB_OUTPUT (poza Actions: pomijane).
def setOutput( key, value )
  path = ENV['GITHUB_OUTPUT']
  File.open( path, 'a' ) { |f| f.puts "#{key}=#{value}" } if path && !path.empty?
end

def main( force )
  last = lastSnapshotTime
  if last && !force && Time.now - last < $MIN_INTERVAL then
    $log.info "Ostatni snapshot z #{last.strftime( '%Y-%m-%d %H:%M' )} ma mniej niż #{$MIN_INTERVAL / 3600} h – pomijam (--force wymusza)"
    setOutput( 'updated', 'false' )
    return
  end
  $log.info( force ? 'Wymuszone pobranie rankingu (--force)' : 'Pobieram ranking' )
  nodes = fetchRanking( $RANKING_SIZE )
  if nodes.empty? then
    $log.error 'Pusty wynik – nic nie zapisuję'
    exit 1
  end
  ts = DateTime.now.to_s
  LanguageColors.update( $LANG_COLORS_DATA_PATH, $log )   # nie zgłasza wyjątków: przy błędzie zostaje poprzedni słownik
  pairs, ids = generateJS( $DB_JS_PATH, nodes, ts )
  saveRanking( pairs, ts, ids )
  setOutput( 'updated', 'true' )
  setOutput( 'ranking_date', ts[0, 10] )
  $log.info "Gotowe: #{pairs.size} repozytoriów (#{$DB_JS_PATH}, #{( File.size( $DB_JS_PATH ) / 1024.0 / 1024 ).round( 2 )} MB)"
end

if __FILE__ == $0 then
  force = false
  ARGV.each do |arg|
    case arg
    when '--force', '-f' then force = true
    when '--help', '-h'
      puts "Użycie: GITHUB_TOKEN=... ruby update.rb [--force]\n  --force, -f  pobierz ranking, nawet jeśli ostatni snapshot ma mniej niż #{$MIN_INTERVAL / 3600} h"
      exit 0
    else
      $log.fatal "Nieznany parametr: #{arg} (dozwolone: --force, --help)"
      exit 2
    end
  end
  if $TOKEN.nil? || $TOKEN.empty? then
    $log.fatal 'Brak zmiennej środowiskowej GITHUB_TOKEN (fine-grained token, publiczne repozytoria, odczyt).'
    exit 1
  end
  begin
    main( force )
  rescue SystemExit
    raise
  rescue Exception => e
    $log.fatal "Błąd: #{e.class}: #{e.message}"
    exit 1
  end
end
