package browser

import (
	"bytes"
	"encoding/json"
)

func jsonNewDecoder(data []byte) *json.Decoder {
	return json.NewDecoder(bytes.NewReader(data))
}
