# Perl Configure hints for emscripten; copied to hints/emscripten.sh in the wasm perl source tree.
# Follows the approach of WebPerl's hints (Hauke Daempfling, same terms as Perl 5), rewritten for current emcc and perl.

# The host build dir provides miniperl and generate_uudmap; the target cannot run them during the build.
hostperl="$EMPERL_HOSTPERLDIR/miniperl"
hostgenerate="$EMPERL_HOSTPERLDIR/generate_uudmap"

osname="emscripten"
archname="wasm"
osvers="`emcc -dumpversion`"
myhostname='localhost'
mydomain='.local'
cf_email='root@localhost'
perladmin='root@localhost'

cc="emcc"
ld="emcc"
ar="emar"
ranlib="emranlib"
nm="`which llvm-nm || echo nm`"

prefix="$EMPERL_PREFIX"
inc_version_list="none"
man1dir="none"
man3dir="none"
loclibpth=''
glibpth=''
locincpth=''

usemymalloc="n"
uselargefiles="n"
use64bitint="define"
usenm='undef'
usethreads='undef'
d_procselfexe='undef'
d_dlopen='undef'
dlsrc='none'
usedl='undef'

static_ext="$EMPERL_STATIC_EXT"
dynamic_ext=''
noextensions='IPC/SysV'
d_libname_unique="define"

# No processes, no real signal delivery in emscripten.
d_sigprocmask='undef'
d_killpg='undef'
d_pause='undef'
d_sigsetjmp='undef'
d_wait4='undef'
d_waitpid='undef'
d_fork='define'
d_vfork='undef'
d_pseudofork='undef'
i_pthread='undef'
d_pthread_atfork='undef'
d_pthread_attr_setscope='undef'
d_pthread_yield='undef'
d_setproctitle='undef'
d_setruid='undef'
d_setrgid='undef'
d_fdclose='undef'
d_malloc_size='undef'
d_malloc_good_size='undef'
d_quad='undef'
selectminbits='32'
alignbytes='8'

optimize="$EMPERL_OPTIMIZE"
ccflags="$ccflags -D_GNU_SOURCE -D_POSIX_C_SOURCE -DPERL_USE_SAFE_PUTENV -DNO_MATHOMS -Wno-null-pointer-arithmetic -Wno-implicit-function-declaration"
ldflags="$ldflags -sALLOW_MEMORY_GROWTH=1"
