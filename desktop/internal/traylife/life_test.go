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

func TestHotkeysKeepAnswerToggleAndAddQuit(t *testing.T) {
	got := map[string]Hotkey{}
	seen := map[int]bool{}
	for _, hk := range Hotkeys() {
		if seen[hk.ID] {
			t.Fatalf("duplicate id %d", hk.ID)
		}
		seen[hk.ID] = true
		got[hk.Action] = hk
		if ActionFor(hk.ID) != hk.Action {
			t.Fatalf("action map %d", hk.ID)
		}
	}
	if len(got) != 3 {
		t.Fatalf("actions = %d", len(got))
	}
	toggle := got["toggle"]
	if !toggle.Alt || !toggle.Shift || toggle.Ctrl || toggle.VK != 0x51 || toggle.Label != "Alt+Shift+Q" {
		t.Fatalf("toggle changed: %+v", toggle)
	}
	answer := got["answer"]
	if !answer.Alt || answer.Shift || answer.Ctrl || answer.VK != 0x51 || answer.Label != "Alt+Q" {
		t.Fatalf("answer changed: %+v", answer)
	}
	exitKey := got["exit"]
	if exitKey.Ctrl || exitKey.Alt || exitKey.Shift || exitKey.VK != 0x31 {
		t.Fatalf("exit must be unmodified top-row 1, got %+v", exitKey)
	}
	if exitKey.VK == 0x61 {
		t.Fatal("numpad 1 must not be the exit key")
	}
	ids := ReleaseIDs()
	if len(ids) != len(Hotkeys()) {
		t.Fatal("shutdown would leave a hotkey registered")
	}
	for i, hk := range Hotkeys() {
		if ids[i] != hk.ID {
			t.Fatalf("release id %d != %d", ids[i], hk.ID)
		}
	}
	if !ExitKeyAvailable(nil) {
		t.Fatal("no conflicts should leave the exit key available")
	}
	if ExitKeyAvailable([]Hotkey{got["exit"]}) {
		t.Fatal("blocked exit key must stay visible as a failure")
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

func TestHungWindowIsNotTreatedAsUsable(t *testing.T) {
	if SecondInstanceState(true, true) != WarnAlreadyRunning {
		t.Fatal("a Not Responding window must not be treated as a healthy instance")
	}
	if SecondInstanceState(true, false) != ShowExistingWindow {
		t.Fatal("healthy window should be shown")
	}
	if SecondInstanceState(false, true) != WarnAlreadyRunning {
		t.Fatal("missing window must not start a second hotkey owner")
	}
}

func TestExitKeyIsNotRegisteredOnTheUIList(t *testing.T) {
	if ExitUsesUIQueue() {
		t.Fatal("exit must not depend on the UI message loop")
	}
	for _, hk := range UIHotkeys() {
		if hk.Action == "exit" || hk.VK == 0x31 {
			t.Fatalf("UI list includes exit: %+v", hk)
		}
	}
	hk, ok := ExitHotkey()
	if !ok || hk.VK != 0x31 || hk.Alt || hk.Shift || hk.Ctrl {
		t.Fatalf("exit hotkey = %+v ok=%v", hk, ok)
	}
	if len(UIHotkeys()) != 2 {
		t.Fatalf("ui hotkeys = %d", len(UIHotkeys()))
	}
}
