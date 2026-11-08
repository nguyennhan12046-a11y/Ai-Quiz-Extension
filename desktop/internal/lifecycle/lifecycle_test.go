package lifecycle

import "testing"

func TestStartupTokens(t *testing.T) {
	got, err := Startup("AIQUIZFORMS_BUILD=v3d", true, false, true)
	if err != nil {
		t.Fatal(err)
	}
	want := "startup AIQUIZFORMS_BUILD=v3d exit=registered answer=failed toggle=registered"
	if got != want {
		t.Fatalf("got %s", got)
	}
	if _, err := Startup("bad build", true, true, true); err == nil {
		t.Fatal("marker with a space should be rejected")
	}
	if _, err := Startup("bad\nbuild", true, true, true); err == nil {
		t.Fatal("marker with a newline should be rejected")
	}
	if ForceExitEvent() != "hotkey-exit-force" {
		t.Fatal(ForceExitEvent())
	}
}
