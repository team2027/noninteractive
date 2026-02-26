#!/usr/bin/env python3
"""PTY bridge: spawns a command in a real PTY, pipes stdin/stdout."""
import pty, os, sys, select, errno

master, slave = pty.openpty()

pid = os.fork()
if pid == 0:
    os.close(master)
    os.setsid()
    os.dup2(slave, 0)
    os.dup2(slave, 1)
    os.dup2(slave, 2)
    os.close(slave)
    os.execvp(sys.argv[1], sys.argv[1:])

os.close(slave)

try:
    while True:
        fds = [master]
        if not sys.stdin.closed:
            fds.append(sys.stdin.fileno())
        r, _, _ = select.select(fds, [], [], 1.0)
        if sys.stdin.fileno() in r:
            data = os.read(sys.stdin.fileno(), 4096)
            if not data:
                continue
            os.write(master, data)
        if master in r:
            data = os.read(master, 4096)
            if not data:
                break
            os.write(sys.stdout.fileno(), data)
            sys.stdout.flush()
except OSError:
    pass

_, status = os.waitpid(pid, 0)
sys.exit(os.WEXITSTATUS(status) if os.WIFEXITED(status) else 1)
