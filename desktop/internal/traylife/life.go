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
