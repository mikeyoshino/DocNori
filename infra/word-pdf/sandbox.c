#define _GNU_SOURCE
#include <linux/landlock.h>
#include <sys/syscall.h>
#include <sys/prctl.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <sys/resource.h>
#include <unistd.h>
#include <fcntl.h>
#include <seccomp.h>
#include <errno.h>
#include <stdio.h>
#include <stdlib.h>

// Fail closed. No privileged container, namespace or Docker socket required.
static void fail(void) { perror("Word conversion isolation unavailable"); exit(78); }
static void allow(int rules, const char *path, __u64 access) {
    int fd = open(path, O_PATH | O_CLOEXEC);
    if (fd < 0) { if (errno == ENOENT) return; fail(); }
    struct stat s; if (fstat(fd, &s)) fail();
    if (!S_ISDIR(s.st_mode)) access &= LANDLOCK_ACCESS_FS_READ_FILE | LANDLOCK_ACCESS_FS_WRITE_FILE | LANDLOCK_ACCESS_FS_EXECUTE;
    struct landlock_path_beneath_attr rule = {.allowed_access = access, .parent_fd = fd};
    if (syscall(SYS_landlock_add_rule, rules, LANDLOCK_RULE_PATH_BENEATH, &rule, 0)) fail();
    close(fd);
}
int main(int argc, char **argv) {
    if (argc < 4) return 64;
    const struct rlimit file_limit = {134217728, 134217728}, core_limit = {0, 0};
    if (setrlimit(RLIMIT_FSIZE, &file_limit) || setrlimit(RLIMIT_CORE, &core_limit)) fail();
    int abi = syscall(SYS_landlock_create_ruleset, NULL, 0, LANDLOCK_CREATE_RULESET_VERSION);
    if (abi < 3) fail();
    __u64 read = LANDLOCK_ACCESS_FS_READ_FILE | LANDLOCK_ACCESS_FS_READ_DIR | LANDLOCK_ACCESS_FS_EXECUTE;
    __u64 all = (1ULL << 15) - 1; // ABI 3: filesystem access including REFER and TRUNCATE.
    struct landlock_ruleset_attr attr = {.handled_access_fs = all};
    int rules = syscall(SYS_landlock_create_ruleset, &attr, sizeof(attr), 0);
    if (rules < 0) fail();
    const char *paths[] = {"/usr", "/lib", "/lib64", "/etc/fonts", "/etc/libreoffice", "/etc/ld.so.cache", "/etc/passwd", "/etc/group", "/etc/localtime", "/proc/meminfo", "/proc/cpuinfo", "/proc/filesystems", NULL};
    for (int i = 0; paths[i]; i++) allow(rules, paths[i], read);
    allow(rules, "/dev/null", read | LANDLOCK_ACCESS_FS_WRITE_FILE);
    allow(rules, "/dev/urandom", read);
    allow(rules, "/dev/random", read);
    allow(rules, argv[1], all);
    if (prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0) || syscall(SYS_landlock_restrict_self, rules, 0)) fail();
    close(rules);
    scmp_filter_ctx filter = seccomp_init(SCMP_ACT_ALLOW);
    if (!filter || seccomp_rule_add(filter, SCMP_ACT_ERRNO(EPERM), SCMP_SYS(socket), 1, SCMP_A0(SCMP_CMP_NE, AF_UNIX)) || seccomp_load(filter)) fail();
    seccomp_release(filter);
    if (chdir(argv[1])) fail();
    execv(argv[2], argv + 2);
    fail();
}
