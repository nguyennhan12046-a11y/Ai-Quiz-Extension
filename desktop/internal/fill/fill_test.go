package fill

import (
	"context"
	"errors"
	"testing"

	"aiquizforms/internal/gate"
)

func TestDelayedReplyAfterDisableDoesNotApply(t *testing.T) {
	g := gate.New(true)
	gen, ok := g.Begin()
	if !ok {
		t.Fatal("begin")
	}
	applied := false
	err := RunFill(context.Background(), g, gen, func(context.Context) ([]Answer, error) {
		g.Disable()
		return []Answer{{ID: "q_0", Answer: "A"}}, nil
	}, func([]Answer) error {
		applied = true
		return nil
	})
	if applied {
		t.Fatal("old reply filled the form")
	}
	if !errors.Is(err, ErrStale) {
		t.Fatalf("err = %v", err)
	}
	g.Enable()
	if err := RunFill(context.Background(), g, gen, func(context.Context) ([]Answer, error) {
		return []Answer{{ID: "q_0", Answer: "A"}}, nil
	}, func([]Answer) error {
		applied = true
		return nil
	}); applied || !errors.Is(err, ErrOff) && !errors.Is(err, ErrStale) {
		t.Fatalf("re-enable accepted old generation: applied=%v err=%v", applied, err)
	}
}

func TestCancelBeforeReplyDoesNotApply(t *testing.T) {
	g := gate.New(true)
	gen, _ := g.Begin()
	ctx, cancel := context.WithCancel(context.Background())
	applied := false
	err := RunFill(ctx, g, gen, func(ctx context.Context) ([]Answer, error) {
		cancel()
		g.Disable()
		return nil, ctx.Err()
	}, func([]Answer) error {
		applied = true
		return nil
	})
	if applied {
		t.Fatal("cancelled reply was applied")
	}
	if !errors.Is(err, ErrStale) {
		t.Fatalf("err = %v", err)
	}
}
