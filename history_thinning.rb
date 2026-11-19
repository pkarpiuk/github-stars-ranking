# Przerzedzanie historii rankingu (ranking-db.json, JSON-lines {ts, data}), żeby plik nie rósł bez końca (ok. 0,4 MB na snapshot).
#
# Reguła (względem najnowszego snapshotu):
#  - wszystkie snapshoty z ostatniego roku zostają;
#  - starsze: jeśli jest ich mniej niż MIN_OLD (5), zostają wszystkie; w przeciwnym razie zostaje tylko pierwszy snapshot każdego
#    kalendarzowego kwartału (stały wybór: raz zachowany snapshot zostaje na zawsze, bo nowsze nie zmieniają "pierwszego w kwartale",
#    więc ponowne przerzedzanie nic nie zmienia, a "Compare to" nie dryfuje);
#  - wiersze bez czytelnego ts zostają bez zmian.
# Zapis atomowy (plik tymczasowy + rename). Zwraca [liczba wierszy przed, po].

require 'date'

module HistoryThinning
  module_function

  MIN_OLD = 5

  def quarter( ts )
    [ts.year, ( ts.month - 1 ) / 3]
  end

  def thin( path, min_old = MIN_OLD )
    return [0, 0] unless File.exist?( path )

    rows = []   # [numer wiersza, DateTime albo nil]
    File.foreach( path ).with_index do |line, i|
      next if line.strip.empty?
      ts_s = line[/\A\{"ts":"([^"]+)"/, 1]
      rows << [i, ( ts_s && ( DateTime.parse( ts_s ) rescue nil ) )]
    end
    dated = rows.select { |_, ts| ts }
    return [rows.size, rows.size] if dated.empty?

    cutoff = dated.map { |_, ts| ts }.max << 12
    old = dated.select { |_, ts| ts < cutoff }
    return [rows.size, rows.size] if old.size < min_old

    drop = {}
    seen = {}
    old.sort_by { |_, ts| ts }.each do |i, ts|
      q = quarter( ts )
      if seen[q] then drop[i] = true else seen[q] = true end
    end
    return [rows.size, rows.size] if drop.empty?

    tmp = "#{path}.tmp"
    File.open( tmp, 'w' ) do |out|
      File.foreach( path ).with_index { |line, i| out.write( line ) unless line.strip.empty? || drop[i] }
    end
    File.rename( tmp, path )
    [rows.size, rows.size - drop.size]
  ensure
    File.delete( tmp ) if tmp && File.exist?( tmp )
  end
end
