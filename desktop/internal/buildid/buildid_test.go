package buildid

import "testing"

func TestIdentity(t *testing.T) {
	if ID != "v3d" {
		t.Fatal(ID)
	}
	if Marker != "AIQUIZFORMS_BUILD=v3d" {
		t.Fatal(Marker)
	}
	if Title() != "Trợ lý điền Google Form — v3d" {
		t.Fatal(Title())
	}
}
