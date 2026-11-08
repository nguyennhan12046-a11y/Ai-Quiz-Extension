//go:build windows

package main

import (
	"os"
	"runtime"
	"time"

	"golang.org/x/sys/windows"

	"aiquizforms/internal/exitwatch"
	"aiquizforms/internal/forceexit"
	"aiquizforms/internal/lifecycle"
	"aiquizforms/internal/traylife"
)

// watchExit registers the top-row 1 key on a thread that does not read the
// setup window's queue. The bool reports whether Windows accepted the key.
func (a *app) watchExit(hk traylife.Hotkey) bool {
	ready := make(chan bool, 1)
	go func() {
		runtime.LockOSThread()
		exitwatch.Run(exitwatch.Config{
			ID:   hk.ID,
			Mods: hotkeyMods(hk),
			VK:   hk.VK,
			OnHotkey: func() {
				a.emergencyStop()
			},
		}, func(registered bool, _ uintptr) {
			select {
			case ready <- registered:
			default:
			}
		})
	}()
	select {
	case ok := <-ready:
		return ok
	case <-time.After(3 * time.Second):
		return false
	}
}

// emergencyStop ends this process. Tray removal and the log line are best
// effort and cannot postpone the stop. The browser process is left running.
func (a *app) emergencyStop() {
	forceexit.Stop(forceexit.Options{
		CleanupBudget: forceexit.DefaultBudget,
		Cleanup: func() {
			a.noteFixed(lifecycle.ForceExitEvent())
			a.removeTray()
		},
		Terminate: terminateSelf,
	})
}

func terminateSelf() {
	_ = windows.TerminateProcess(windows.CurrentProcess(), 0)
	os.Exit(0)
}
