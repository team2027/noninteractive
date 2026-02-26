#!/usr/bin/env python3
"""PTY bridge: spawns a command in a real PTY, pipes stdin/stdout."""
import pty, os, sys, select, fcntl, termios, struct

master, slave = pty.openpty()

# set terminal size so TUI libraries render correctly
winsize = struct.pack("HHHH", 24, 80, 0, 0)
fcntl.ioctl(slave, termios.TIOCSWINSZ, winsize)

pid = os.fork()
if pid == 0:
    os.close(master)
    os.setsid()
    # make slave the controlling terminal
    fcntl.ioctl(slave, termios.TIOCSCTTY, 0)
    os.dup2(slave, 0)
    os.dup2(slave, 1)
    os.dup2(slave, 2)
    os.close(slave)
    os.execvp(sys.argv[1], sys.argv[1:])

os.close(slave)

try:
    while True:
        fds = [master]
        try:
            fds.append(sys.stdin.fileno())
        except ValueError:
            pass
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
except OSError:
    pass

_, status = os.waitpid(pid, 0)
sys.exit(os.WEXITSTATUS(status) if os.WIFEXITED(status) else 1)
