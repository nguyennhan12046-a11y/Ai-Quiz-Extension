package traylife

import "testing"

func TestCloseHidesOnlyWhenTrayExists(t *testing.T) {
	if DecideClose(true) != HideToTray {
		t.Fatal("expected hide")
	}
	if DecideClose(false) != KeepVisibleShowError {
		t.Fatal("missing tray must keep the window reachable")
	}
}

func TestStartHiddenRequiresTray(t *testing.T) {
	if ShouldStartHidden(false, true) {
		t.Fatal("default start should show the window")
	}
	if !ShouldStartHidden(true, true) {
		t.Fatal("remembered tray start should hide")
	}
	if ShouldStartHidden(true, false) {
		t.Fatal("must not hide when the tray icon failed")
	}
}

func TestExplorerRestartUnhidesIfIconCannotReturn(t *testing.T) {
	if MustShowAfterTrayLoss(true, true) {
		t.Fatal("recreated icon can stay hidden")
	}
	if !MustShowAfterTrayLoss(true, false) {
		t.Fatal("hidden window must return if the tray icon is lost")
	}
	if MustShowAfterTrayLoss(false, false) {
		t.Fatal("visible window stays put")
	}
}

func TestVisibleWindowDestroyDoesNotEndProcess(t *testing.T) {
	if EndProcess(false) {
		t.Fatal("hiding or losing the visible window must not exit")
	}
	if !EndProcess(true) {
		t.Fatal("explicit Exit should end the process")
	}
}

func TestSecondInstanceDoesNotOwnHotkeys(t *testing.T) {
	if SecondInstance(true) != ShowExistingWindow {
		t.Fatal("existing window should be restored")
	}
	if SecondInstance(false) != WarnAlreadyRunning {
		t.Fatal("missing window should warn instead of starting another hotkey owner")
	}
}
