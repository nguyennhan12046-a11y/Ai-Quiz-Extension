package forceexit

import (
	"sync/atomic"
	"testing"
	"time"
)

func TestStopRunsCleanupThenTerminate(t *testing.T) {
	var order []string
	Stop(Options{
		CleanupBudget: time.Second,
		Cleanup:       func() { order = append(order, "cleanup") },
		Terminate:     func() { order = append(order, "terminate") },
	})
	if len(order) != 2 || order[0] != "cleanup" || order[1] != "terminate" {
		t.Fatalf("order = %v", order)
	}
}

func TestStopTerminatesWhenCleanupBlocks(t *testing.T) {
	release := make(chan struct{})
	var calls atomic.Int32
	start := time.Now()
	Stop(Options{
		CleanupBudget: 40 * time.Millisecond,
		Cleanup: func() {
			<-release
		},
		Terminate: func() { calls.Add(1) },
	})
	elapsed := time.Since(start)
	if calls.Load() != 1 {
		t.Fatalf("terminate calls = %d", calls.Load())
	}
	if elapsed > time.Second {
		t.Fatalf("blocked cleanup postponed terminate for %s", elapsed)
	}
	close(release)
}

func TestStopWithNoCleanupStillTerminates(t *testing.T) {
	var calls atomic.Int32
	Stop(Options{Terminate: func() { calls.Add(1) }})
	if calls.Load() != 1 {
		t.Fatalf("terminate calls = %d", calls.Load())
	}
}
