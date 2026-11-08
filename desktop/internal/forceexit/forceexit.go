// Package forceexit stops this process without waiting for a stuck window thread.
package forceexit

import "time"

// DefaultBudget is how long tray cleanup may run before the process stops anyway.
const DefaultBudget = 250 * time.Millisecond

// Options controls one emergency stop.
// Cleanup may remove the tray icon or append a log line. It must not be required
// to finish: a stuck cleanup cannot keep the process alive past CleanupBudget.
// Terminate ends this process only. It is not given a process id to choose from.
type Options struct {
	CleanupBudget time.Duration
	Cleanup       func()
	Terminate     func()
}

// Stop runs Cleanup without letting it postpone Terminate.
// A cleanup that blocks, including one that waits on the UI thread, loses the race.
func Stop(opt Options) {
	budget := opt.CleanupBudget
	if budget <= 0 {
		budget = DefaultBudget
	}
	done := make(chan struct{})
	go func() {
		defer close(done)
		defer func() { recover() }()
		if opt.Cleanup != nil {
			opt.Cleanup()
		}
	}()
	timer := time.NewTimer(budget)
	defer timer.Stop()
	select {
	case <-done:
	case <-timer.C:
	}
	if opt.Terminate != nil {
		opt.Terminate()
	}
}
