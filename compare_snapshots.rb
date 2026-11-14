# Wybór snapshotów rankingu do porównania (kolumna Change i lista "Compare to" w github-stars-ranking).
#
# Zawsze porównujemy z najnowszym rankingiem. Do listy trafiają snapshoty najbliższe czasowo celom wstecz od najnowszego:
# 1 tydzień, 1 miesiąc, 3 miesiące, 6 miesięcy, 1 rok i kolejne lata (aż do najstarszego snapshotu). Jeśli dokładnego
# snapshotu nie ma, bierzemy najbliższy (np. sprzed 4 lat i 4 miesięcy zamiast żadnego); etykieta pokazuje jego prawdziwy wiek,
# a snapshot wybrany dla kilku celów występuje na liście raz. Historia to ranking-db.json (JSON-lines: {ts, data}).
#
# Dla wybranych snapshotów generujemy tablice pozycji wyrównane z bieżącym RANKING (ranks[i] = pozycja i-tego repozytorium
# z bieżącego rankingu w tamtym snapshocie albo 0, gdy go tam nie było), dzięki czemu db.js zawiera same liczby.

require 'json'
require 'date'

module CompareSnapshots
  module_function

  def plural( n, word )
    "#{n} #{word}#{n == 1 ? '' : 's'}"
  end

  # Wiek jako tekst: "5 days", "1 week", "3 months", "1 year 11 months" (od <from> do <to>).
  def age_label( from, to )
    secs = ( ( to - from ) * 86400 ).to_i
    return "#{[secs / 60, 1].max} min" if secs < 3600
    return plural( secs / 3600, 'hour' ) if secs < 86400
    months = ( to.year * 12 + to.month ) - ( from.year * 12 + from.month )
    months -= 1 if to.day < from.day || ( to.day == from.day && to.hour * 3600 + to.min * 60 + to.sec < from.hour * 3600 + from.min * 60 + from.sec )
    months = 0 if months < 0
    if months < 1 then
      days = secs / 86400
      return days % 7 == 0 ? plural( days / 7, 'week' ) : plural( days, 'day' )
    end
    if months < 12 then
      weeks = ( to - ( from >> months ) ).to_i / 7
      return weeks > 0 ? "#{plural( months, 'month' )} #{plural( weeks, 'week' )}" : plural( months, 'month' )
    end
    years, rest = months.divmod( 12 )
    weeks = ( to - ( from >> months ) ).to_i / 7
    extra = rest > 0 ? plural( rest, 'month' ) : ( weeks > 0 ? plural( weeks, 'week' ) : nil )   # "2 years 4 weeks" zamiast dwóch identycznych "2 years"
    extra ? "#{plural( years, 'year' )} #{extra}" : plural( years, 'year' )
  end

  # Cele czasowe wstecz od najnowszego rankingu (rosnący wiek); lata aż do wieku najstarszego snapshotu.
  def targets( latest, oldest )
    list = [latest - 7, latest << 1, latest << 3, latest << 6]
    n = 1
    loop do
      t = latest << ( 12 * n )
      list << t
      break if t <= oldest || n > 100
      n += 1
    end
    list
  end

  # Wybór snapshotów do porównania: zwraca [[DateTime, ts string, numer wiersza w pliku historii]] w kolejności rosnącego wieku
  # (bez duplikatów); puste, gdy brak historii. Używane przez build.
  def select( latest, history_path )
    return [] unless history_path && File.exist?( history_path )

    # przebieg 1: same znaczniki czasu (bez parsowania ciężkich wierszy), tylko snapshoty starsze od najnowszego
    entries = []   # [DateTime, ts string, numer wiersza]
    File.foreach( history_path ).with_index do |line, i|
      ts_s = line[/\A\{"ts":"([^"]+)"/, 1] or next
      ts = ( DateTime.parse( ts_s ) rescue nil ) or next
      entries << [ts, ts_s, i] if ts < latest
    end
    return [] if entries.empty?
    entries.sort_by! { |e| e[0] }

    chosen = []
    targets( latest, entries.first[0] ).each do |target|
      best = entries.min_by { |e| [( target - e[0] ).abs, e[0]] }   # najbliższy; przy remisie starszy
      chosen << best unless chosen.include?( best )
    end
    chosen
  end

  # Dopasowuje wpisy snapshotu do bieżącego rankingu. Wpisy mają postać [nazwa, gwiazdki] albo [nazwa, gwiazdki, id], gdzie id to
  # databaseId repozytorium (stały mimo zmian nazwy). Zwraca [pozycja w snapshocie albo 0, gwiazdki w snapshocie albo 0] dla
  # każdego repozytorium bieżącego rankingu. Kolejność dopasowania:
  #  1. po id, gdy znamy je po obu stronach;
  #  2. po nazwie (bez rozróżniania wielkości liter), ale tylko gdy to nie jest INNE repozytorium: jeśli oba id są znane i różne,
  #     nazwa została użyta ponownie i dopasowania nie ma.
  def match( ranking, ids, pairs )
    by_id = {}
    by_name = {}
    pairs.each_with_index do |( name, stars, id ), k|
      by_id[id] ||= [k + 1, stars] if id
      by_name[name.to_s.downcase] ||= [k + 1, stars, id]
    end
    ranking.each_with_index.map do |( name, _stars ), i|
      cur_id = ids && ids[i]
      hit = cur_id && by_id[cur_id]
      unless hit then
        cand = by_name[name.to_s.downcase]
        hit = cand[0, 2] if cand && ( cand[2].nil? || cur_id.nil? || cand[2] == cur_id )
      end
      hit || [0, 0]
    end
  end

  # Zwraca [{ 'ts', 'label', 'n', 'ranks', 'stars' }] albo [] (brak historii). `ranking` to bieżące [['/owner/name', stars], ...],
  # `ids` (opcjonalnie) to wyrównane z nim databaseId. ranks[i] i stars[i] to pozycja i gwiazdki i-tego repozytorium w tamtym
  # snapshocie (0, gdy go tam nie było).
  def build( ranking, latest_ts, history_path, ids = nil )
    latest = DateTime.parse( latest_ts )
    chosen = select( latest, history_path )
    return [] if chosen.empty?

    # przebieg 2: pełne dane tylko wybranych snapshotów
    wanted = chosen.map { |e| e[2] }
    data = {}
    File.foreach( history_path ).with_index do |line, i|
      next unless wanted.include?( i )
      data[i] = ( JSON.parse( line )['data'] rescue nil )
    end

    chosen.filter_map do |ts, ts_s, i|
      pairs = data[i]
      next unless pairs.is_a?( Array ) && !pairs.empty?
      matched = match( ranking, ids, pairs )
      {
        'ts' => ts_s,
        'label' => "#{age_label( ts, latest )} ago (#{ts.strftime( '%Y-%m-%d' )})",
        'n' => pairs.size,
        'ranks' => matched.map { |r, _s| r },
        'stars' => matched.map { |_r, s| s }
      }
    end
  end
end
