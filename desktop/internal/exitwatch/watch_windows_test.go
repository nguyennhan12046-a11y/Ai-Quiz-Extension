//go:build windows

package exitwatch

import (
	"runtime"
	"sync"
	"testing"
	"time"

	"golang.org/x/sys/windows"
)

// TestHotkeyLoopRunsWhileOtherThreadIsBlocked posts the exit message while a
// second OS thread is inside a blocking Sleep. It does not press a physical key
// and it does not call TerminateProcess; the parent probe covers process exit.
func TestHotkeyLoopRunsWhileOtherThreadIsBlocked(t *testing.T) {
	sleep := windows.NewLazySystemDLL("kernel32.dll").NewProc("Sleep")
	go func() {
		runtime.LockOSThread()
		_, _, _ = sleep.Call(20000)
	}()

	fired := make(chan struct{})
	var once sync.Once
	ready := make(chan uintptr, 1)
	var registered bool
	go func() {
		runtime.LockOSThread()
		Run(Config{
			ID:           3,
			VK:           0x31,
			AcceptPosted: true,
			OnHotkey: func() {
				once.Do(func() { close(fired) })
				requestStop()
			},
		}, func(ok bool, hwnd uintptr) {
			registered = ok
			ready <- hwnd
		})
	}()

	hwnd := <-ready
	t.Logf("exit-hotkey-registered=%v hwnd=%x", registered, hwnd)
	if hwnd == 0 {
		t.Fatal("watch window was not created")
	}
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		postHotkey(hwnd, 3)
		select {
		case <-fired:
			return
		case <-time.After(20 * time.Millisecond):
		}
	}
	t.Fatal("watch thread did not observe the exit hotkey while another thread was blocked in Sleep")
}
