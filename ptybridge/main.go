package main

import (
	"io"
	"os"
	"os/exec"
	"os/signal"
	"syscall"

	"github.com/creack/pty"
)

func main() {
	if len(os.Args) < 2 {
		os.Stderr.WriteString("usage: ptybridge <command> [args...]\n")
		os.Exit(1)
	}

	cmd := exec.Command(os.Args[1], os.Args[2:]...)
	cmd.Env = os.Environ()

	ptmx, err := pty.StartWithSize(cmd, &pty.Winsize{Rows: 24, Cols: 80})
	if err != nil {
		os.Stderr.WriteString("pty start: " + err.Error() + "\n")
		os.Exit(1)
	}
	defer ptmx.Close()

	// forward SIGWINCH to the PTY
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGWINCH)
	go func() {
		for range sigCh {
			// could resize here if needed
		}
	}()

	// stdin -> pty
	go func() {
		io.Copy(ptmx, os.Stdin)
	}()

	// pty -> stdout
	io.Copy(os.Stdout, ptmx)

	// wait for child and exit with its code
	if err := cmd.Wait(); err != nil {
		if exitErr, ok := err.(*exec.ExitError); ok {
			os.Exit(exitErr.ExitCode())
		}
		os.Exit(1)
	}
}
