package traylife

// CloseAction is what the main window close button does.
type CloseAction int

const (
	// HideToTray keeps the process and hotkeys, and removes the taskbar button.
	HideToTray CloseAction = iota
	// KeepVisibleShowError is used when the tray icon is not installed.
	KeepVisibleShowError
)

// DecideClose hides only after the tray icon exists, so the process cannot become unreachable.
func DecideClose(trayReady bool) CloseAction {
	if trayReady {
		return HideToTray
	}
	return KeepVisibleShowError
}

// ShouldStartHidden is the optional remembered preference. The window still opens first
// unless this is set, and it never hides when the tray icon failed.
func ShouldStartHidden(startInTray, trayReady bool) bool {
	return startInTray && trayReady
}

// MustShowAfterTrayLoss unhides the window if Explorer restarts and the icon cannot be recreated.
func MustShowAfterTrayLoss(windowHidden, recreated bool) bool {
	return windowHidden && !recreated
}

// SecondInstanceAction avoids a second process registering the same hotkeys.
type SecondInstanceAction int

const (
	ShowExistingWindow SecondInstanceAction = iota
	WarnAlreadyRunning
)

func SecondInstance(foundWindow bool) SecondInstanceAction {
	if foundWindow {
		return ShowExistingWindow
	}
	return WarnAlreadyRunning
}

// EndProcess reports whether this window destruction should stop the program.
// Destroying the visible window is not an exit. Only the explicit Exit command is.
func EndProcess(explicitExit bool) bool {
	return explicitExit
}

// Hotkey is a global shortcut owned by the hidden message window.
// VK is the Windows virtual-key code. Exit uses top-row 1 (0x31), not numpad 1 (0x61).
type Hotkey struct {
	ID     int
	Alt    bool
	Shift  bool
	Ctrl   bool
	VK     uint32
	Action string
	Label  string
}

// Hotkeys are the only global shortcuts this app registers.
// Alt+Q answers, Alt+Shift+Q toggles, and the plain top-row 1 key exits.
func Hotkeys() []Hotkey {
	return []Hotkey{
		{ID: 1, Alt: true, Shift: true, VK: 0x51, Action: "toggle", Label: "Alt+Shift+Q"},
		{ID: 2, Alt: true, VK: 0x51, Action: "answer", Label: "Alt+Q"},
		{ID: 3, VK: 0x31, Action: "exit", Label: "phím 1 hàng trên"},
	}
}

func ActionFor(id int) string {
	for _, hk := range Hotkeys() {
		if hk.ID == id {
			return hk.Action
		}
	}
	return ""
}

// ReleaseIDs is every hotkey id that shutdown must unregister.
func ReleaseIDs() []int {
	ids := make([]int, 0, len(Hotkeys()))
	for _, hk := range Hotkeys() {
		ids = append(ids, hk.ID)
	}
	return ids
}
