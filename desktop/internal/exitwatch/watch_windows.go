//go:build windows

package exitwatch

import (
	"runtime"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"
)

const (
	wmHotkey = 0x0312
	wmQuit   = 0x0012
)

var (
	user32              = windows.NewLazySystemDLL("user32.dll")
	kernel32            = windows.NewLazySystemDLL("kernel32.dll")
	procRegisterClassEx = user32.NewProc("RegisterClassExW")
	procCreateWindowEx  = user32.NewProc("CreateWindowExW")
	procDefWindowProc   = user32.NewProc("DefWindowProcW")
	procGetMessage      = user32.NewProc("GetMessageW")
	procTranslate       = user32.NewProc("TranslateMessage")
	procDispatch        = user32.NewProc("DispatchMessageW")
	procPostQuit        = user32.NewProc("PostQuitMessage")
	procPostMessage     = user32.NewProc("PostMessageW")
	procRegisterHotKey  = user32.NewProc("RegisterHotKey")
	procUnregisterHot   = user32.NewProc("UnregisterHotKey")
	procGetModule       = kernel32.NewProc("GetModuleHandleW")
	exitClassName       = utf16("AIQuizFormsExitWatch")
)

// Config is one hotkey owned by the watch thread.
// AcceptPosted is only for the in-process failure test. The installed app leaves
// it false, so a failed registration does not turn a posted message into an exit.
type Config struct {
	ID           int
	Mods         uintptr
	VK           uint32
	AcceptPosted bool
	OnHotkey     func()
}

type wndClass struct {
	Size       uint32
	Style      uint32
	WndProc    uintptr
	ClsExtra   int32
	WndExtra   int32
	Instance   windows.Handle
	Icon       windows.Handle
	Cursor     windows.Handle
	Background windows.Handle
	MenuName   *uint16
	ClassName  *uint16
	IconSm     windows.Handle
}

type point struct{ X, Y int32 }

type msg struct {
	HWND    uintptr
	Message uint32
	WParam  uintptr
	LParam  uintptr
	Time    uint32
	Pt      point
}

// Run creates a message-only window on the calling OS thread, registers one
// hotkey there, and reads that thread's queue until WM_QUIT. The caller must
// runtime.LockOSThread before calling Run. ready is called once, before the
// queue is read, and must not wait for the setup window.
func Run(cfg Config, ready func(registered bool, hwnd uintptr)) {
	cb := windows.NewCallback(exitWndProc)
	inst, _, _ := procGetModule.Call(0)
	cls := wndClass{
		Size:      uint32(unsafe.Sizeof(wndClass{})),
		WndProc:   cb,
		Instance:  windows.Handle(inst),
		ClassName: exitClassName,
	}
	procRegisterClassEx.Call(uintptr(unsafe.Pointer(&cls)))
	hwnd, _, _ := procCreateWindowEx.Call(
		0,
		uintptr(unsafe.Pointer(exitClassName)),
		0,
		0,
		0, 0, 0, 0,
		hwndMessage(), 0, inst, 0,
	)
	registered := false
	if hwnd != 0 {
		ok, _, _ := procRegisterHotKey.Call(hwnd, uintptr(cfg.ID), cfg.Mods, uintptr(cfg.VK))
		registered = ok != 0
	}
	if ready != nil {
		ready(registered, hwnd)
	}
	if hwnd == 0 {
		runtime.KeepAlive(cb)
		return
	}
	defer procUnregisterHot.Call(hwnd, uintptr(cfg.ID))
	var m msg
	for {
		r, _, _ := procGetMessage.Call(uintptr(unsafe.Pointer(&m)), 0, 0, 0)
		if int32(r) == -1 {
			time.Sleep(20 * time.Millisecond)
			continue
		}
		if r == 0 {
			break
		}
		if m.Message == wmHotkey && m.WParam == uintptr(cfg.ID) && (registered || cfg.AcceptPosted) {
			if cfg.OnHotkey != nil {
				cfg.OnHotkey()
			}
			continue
		}
		procTranslate.Call(uintptr(unsafe.Pointer(&m)))
		procDispatch.Call(uintptr(unsafe.Pointer(&m)))
	}
	runtime.KeepAlive(cb)
}

func exitWndProc(hwnd, message, wparam, lparam uintptr) uintptr {
	r, _, _ := procDefWindowProc.Call(hwnd, message, wparam, lparam)
	return r
}

func hwndMessage() uintptr {
	return ^uintptr(2)
}

func postHotkey(hwnd uintptr, id int) {
	procPostMessage.Call(hwnd, wmHotkey, uintptr(id), 0)
}

func requestStop() {
	procPostQuit.Call(0)
}

func utf16(s string) *uint16 {
	p, err := windows.UTF16PtrFromString(s)
	if err != nil {
		p, _ = windows.UTF16PtrFromString("")
	}
	return p
}
