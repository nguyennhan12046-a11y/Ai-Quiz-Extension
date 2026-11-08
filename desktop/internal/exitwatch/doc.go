// Package exitwatch registers the process-exit hotkey on its own OS thread.
// RegisterHotKey delivers WM_HOTKEY only to the thread that registered it.
// That thread must not be the thread that paints the setup window: a window
// marked Not Responding is a thread that is not reading its queue, so an exit
// key on that same queue would never run.
package exitwatch
