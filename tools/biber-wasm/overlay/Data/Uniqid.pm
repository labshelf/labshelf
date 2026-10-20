# Generates process-unique ids from a counter; replaces CPAN Data::Uniqid 0.12 in the wasm build.
# TRAP: the CPAN version derives ids from gettimeofday and the pid; under emscripten the clock ticks in milliseconds
# and the pid is always 42, so biber's name ids collide and names overwrite each other in the .bbl.
package Data::Uniqid;
use strict;
use warnings;
use Exporter 'import';
our @EXPORT_OK = qw(suniqid uniqid luniqid);
our $VERSION = '0.12';

my $count = 0;
sub suniqid { return 'u' . ++$count }
sub uniqid  { return 'u' . ++$count }
sub luniqid { return 'u' . ++$count }

1;
