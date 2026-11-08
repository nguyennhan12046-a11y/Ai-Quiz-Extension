package gate

import "testing"

func TestOffBlocksAndOldGenerationCannotFillAfterOn(t *testing.T) {
	g := New(true)
	if _, ok := g.Begin(); !ok {
		t.Fatal("expected begin while on")
	}
	gen, ok := g.Begin()
	if !ok || !g.Allow(gen) {
		t.Fatal("fresh generation should be allowed")
	}
	g.Disable()
	if g.Enabled() || g.Allow(gen) {
		t.Fatal("disable must block the in-flight generation")
	}
	if _, ok := g.Begin(); ok {
		t.Fatal("begin must fail while off")
	}
	g.Enable()
	if g.Allow(gen) {
		t.Fatal("turning back on must not accept the old reply")
	}
	next, ok := g.Begin()
	if !ok || next == gen || !g.Allow(next) {
		t.Fatal("a new action after enable should get a new generation")
	}
}
