#!/usr/bin/ruby
# Ręcznie odświeża language_colors.json (kopia dołączana do repozytorium i obrazu; to wartość startowa i zapas).
# Worker odświeża własną kopię w var/rankings/ przy każdym tygodniowym pobraniu rankingu (language_colors.rb), więc to polecenie
# jest potrzebne tylko do aktualizacji kopii w repozytorium. Bez tokenu.
#   ruby update_language_colors.rb

require_relative 'language_colors'

path = File.join( __dir__, 'language_colors.json' )
logger = Object.new
def logger.info( msg ) puts msg end
def logger.warn( msg ) STDERR.puts "BŁĄD: #{msg}" end
exit( LanguageColors.update( path, logger ) ? 0 : 1 )
