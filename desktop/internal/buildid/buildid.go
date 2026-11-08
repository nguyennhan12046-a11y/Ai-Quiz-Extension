package buildid

// ID is the user-visible build. It is shown in the window title and the startup log line.
const ID = "v3d"

// Marker is an ASCII token stored in the program and written to status.log.
const Marker = "AIQUIZFORMS_BUILD=v3d"

// Title is the setup window caption, including the build so a running window can be identified.
func Title() string {
	return "Trợ lý điền Google Form — " + ID
}
