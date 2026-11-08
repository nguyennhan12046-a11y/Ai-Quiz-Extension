package fill

import (
	"context"
	"errors"

	"aiquizforms/internal/gate"
)

var (
	ErrOff   = errors.New("assistant is off")
	ErrStale = errors.New("reply is stale")
)

type Answer struct {
	ID     string `json:"id"`
	Answer string `json:"answer"`
}

type Question struct {
	ID      string   `json:"id"`
	Type    string   `json:"type"`
	Text    string   `json:"text"`
	Options []string `json:"options"`
}

// RunFill calls the model, then applies answers only if this generation is still current.
// Cancelling ctx stops waiting. It does not undo a request the provider already accepted.
func RunFill(ctx context.Context, g *gate.Gate, gen uint64, ask func(context.Context) ([]Answer, error), apply func([]Answer) error) error {
	if !g.Allow(gen) {
		return ErrOff
	}
	answers, err := ask(ctx)
	if err != nil {
		if errors.Is(err, context.Canceled) && !g.Allow(gen) {
			return ErrStale
		}
		return err
	}
	if !g.Allow(gen) {
		return ErrStale
	}
	return apply(answers)
}
