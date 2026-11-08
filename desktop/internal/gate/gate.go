package gate

import "sync"

// Gate is the on/off switch. Each Begin captures a generation. Disable and
// Enable both move the generation forward, so a reply started earlier cannot
// fill the form after the switch changes.
type Gate struct {
	mu      sync.Mutex
	enabled bool
	seq     uint64
}

func New(enabled bool) *Gate {
	return &Gate{enabled: enabled, seq: 1}
}

func (g *Gate) Enabled() bool {
	g.mu.Lock()
	defer g.mu.Unlock()
	return g.enabled
}

func (g *Gate) Begin() (uint64, bool) {
	g.mu.Lock()
	defer g.mu.Unlock()
	if !g.enabled {
		return 0, false
	}
	g.seq++
	return g.seq, true
}

func (g *Gate) Allow(gen uint64) bool {
	g.mu.Lock()
	defer g.mu.Unlock()
	return g.enabled && gen != 0 && gen == g.seq
}

func (g *Gate) Disable() {
	g.mu.Lock()
	defer g.mu.Unlock()
	g.enabled = false
	g.seq++
}

func (g *Gate) Enable() {
	g.mu.Lock()
	defer g.mu.Unlock()
	g.enabled = true
	g.seq++
}
