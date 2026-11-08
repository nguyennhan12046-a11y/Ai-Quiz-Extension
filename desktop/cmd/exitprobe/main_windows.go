//go:build windows

// Exit probe: the main thread blocks in Sleep, as a setup window that is not
// reading messages. A second thread owns the exit hotkey queue. A posted
// WM_HOTKEY must end the process even though cleanup blocks.
// This is not a physical key press.
package main

import (
	"os"
	"runtime"
	"time"

	"golang.org/x/sys/windows"

	"aiquizforms/internal/exitwatch"
	"aiquizforms/internal/forceexit"
)

func main() {
	if len(os.Args) != 2 {
		os.Exit(2)
	}
	out := os.Args[1]
	runtime.LockOSThread()
	ready := make(chan uintptr, 1)
	go func() {
		runtime.LockOSThread()
		exitwatch.Run(exitwatch.Config{
			ID:           3,
			VK:           0x31,
			AcceptPosted: true,
			OnHotkey: func() {
				forceexit.Stop(forceexit.Options{
					CleanupBudget: 200 * time.Millisecond,
					Cleanup: func() {
						time.Sleep(30 * time.Second)
					},
					Terminate: func() {
						if f, err := os.OpenFile(out, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o644); err == nil {
							_, _ = f.WriteString("terminated\n")
							_ = f.Sync()
							_ = f.Close()
						}
						_ = windows.TerminateProcess(windows.CurrentProcess(), 7)
						os.Exit(7)
					},
				})
			},
		}, func(_ bool, hwnd uintptr) {
			ready <- hwnd
		})
	}()
	hwnd := <-ready
	if hwnd == 0 {
		os.Exit(3)
	}
	user32 := windows.NewLazySystemDLL("user32.dll")
	post := user32.NewProc("PostMessageW")
	go func() {
		for i := 0; i < 40; i++ {
			_, _, _ = post.Call(hwnd, 0x0312, 3, 0)
			time.Sleep(25 * time.Millisecond)
		}
	}()
	kernel32 := windows.NewLazySystemDLL("kernel32.dll")
	sleep, _, _ := kernel32.NewProc("Sleep").Call(20000)
	_ = sleep
	os.Exit(4)
}
