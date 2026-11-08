package page

import _ "embed"

//go:embed forms_page.js
var Source string

func Script() string {
	return Source
}
