# Słownik kolorów języków programowania (nazwa języka => kolor hex) z listy Linguist, czyli tej, z której GitHub bierze kolory
# (m.in. primaryLanguage.color w GraphQL). Używany przez worker.rb przy każdym pobraniu rankingu oraz przez update_language_colors.rb.

require 'net/http'
require 'uri'
require 'yaml'
require 'json'
require 'fileutils'

module LanguageColors
  URL = ENV['LINGUIST_URL'] || 'https://raw.githubusercontent.com/github-linguist/linguist/main/lib/linguist/languages.yml'   # zmienna tylko do testów
  MIN_COLORS = 100        # mniej = plik Linguist ma inny format albo jest uszkodzony
  MIN_SHARE_OF_OLD = 0.8  # nowy słownik mniejszy niż 80% poprzedniego uznajemy za podejrzany

  module_function

  # Pobiera i parsuje listę Linguist. Zwraca { nazwa => kolor }; przy każdym problemie zgłasza wyjątek.
  def fetch( url = URL )
    uri = URI( url )
    http = Net::HTTP.new( uri.host, uri.port )
    http.use_ssl = ( uri.scheme == 'https' )
    http.open_timeout = 10
    http.read_timeout = 30
    res = http.request( Net::HTTP::Get.new( uri.request_uri ) )
    raise "HTTP #{res.code}" unless res.code == '200'
    yaml = YAML.safe_load( res.body, aliases: true )
    raise 'nieoczekiwany format listy Linguist' unless yaml.is_a?( Hash )
    colors = yaml.select { |_name, v| v.is_a?( Hash ) && v['color'].to_s =~ /\A#[0-9a-fA-F]{3,8}\z/ }.map { |name, v| [name.to_s, v['color']] }.sort.to_h
    raise "za mało kolorów (#{colors.size})" if colors.size < MIN_COLORS
    colors
  end

  # Odświeża plik słownika. NIGDY nie zgłasza wyjątku (nie może przerwać pobierania rankingu): przy błędzie zostaje poprzedni plik.
  # Zapis jest atomowy. Zwraca true, gdy plik zaktualizowano.
  def update( path, logger = nil )
    colors = fetch
    old = File.exist?( path ) ? ( JSON.parse( File.read( path ) ) rescue nil ) : nil
    if old.is_a?( Hash ) && !old.empty? && colors.size < old.size * MIN_SHARE_OF_OLD
      raise "nowy słownik (#{colors.size}) jest podejrzanie mniejszy od poprzedniego (#{old.size})"
    end
    FileUtils.mkdir_p( File.dirname( path ) )
    tmp = "#{path}.tmp"
    File.write( tmp, "{\n" + colors.map { |k, v| "  #{JSON.generate( k )}: #{JSON.generate( v )}" }.join( ",\n" ) + "\n}\n" )
    File.rename( tmp, path )
    changed = old.is_a?( Hash ) ? colors.count { |k, v| old[k] != v } + ( old.keys - colors.keys ).size : colors.size
    logger.info "Słownik kolorów języków zaktualizowany: #{colors.size} języków, zmian względem poprzedniego: #{changed}" if logger
    true
  rescue StandardError => e
    logger.warn "Nie udało się zaktualizować słownika kolorów języków (#{e.class}: #{e.message}) – zostaje poprzedni" if logger
    File.delete( "#{path}.tmp" ) if File.exist?( "#{path}.tmp" ) rescue nil
    false
  end
end
