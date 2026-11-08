//go:build windows

package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"

	"aiquizforms/internal/browser"
	"aiquizforms/internal/config"
	"aiquizforms/internal/diag"
	"aiquizforms/internal/fill"
	"aiquizforms/internal/forms"
	"aiquizforms/internal/gate"
	"aiquizforms/internal/groq"
	"aiquizforms/internal/traylife"
	pagejs "aiquizforms/page"
)

const (
	wsOverlappedWindow = 0x00CF0000
	wsVisible          = 0x10000000
	wsChild            = 0x40000000
	wsTabStop          = 0x00010000
	wsBorder           = 0x00800000
	wsVScroll          = 0x00200000
	esPassword         = 0x0020
	esAutoHScroll      = 0x0080
	esMultiline        = 0x0004
	esReadOnly         = 0x0800
	esAutoVScroll      = 0x0040
	wmDestroy          = 0x0002
	wmClose            = 0x0010
	wmCommand          = 0x0111
	wmSetFont          = 0x0030
	wmGetText          = 0x000D
	wmGetTextLength    = 0x000E
	wmSetText          = 0x000C
	wmHotkey           = 0x0312
	wmAppStatus        = 0x8000 + 1
	wmTray             = 0x8000 + 2
	wmRecreate         = 0x8000 + 3
	wmSysCommand       = 0x0112
	scClose            = 0xF060
	wmLButtonDblClk    = 0x0203
	wmRButtonUp        = 0x0205
	wmContextMenu      = 0x007B
	modAlt             = 0x0001
	modControl         = 0x0002
	modShift           = 0x0004
	vkQ                = 0x51
	swHide             = 0
	swShow             = 5
	swRestore          = 9
	nimAdd             = 0
	nimDelete          = 2
	nimSetVersion      = 4
	nifMessage         = 0x1
	nifIcon            = 0x2
	nifTip             = 0x4
	notifyIconVersion4 = 4
	mfString           = 0
	mfSeparator        = 0x800
	tpmRightAlign      = 0x0008
	tpmBottomAlign     = 0x0020
	tpmReturnCmd       = 0x0100
	tpmNoNotify        = 0x0080
	idiApplication     = 32512
	imageIcon          = 1
	lrShared           = 0x8000
	errorAlreadyExists = 183
	mbYesNo            = 0x00000004
	idYes              = 6

	idKey        = 101
	idBase       = 102
	idModel      = 103
	idSave       = 201
	idOpen       = 202
	idToggle     = 203
	idDetect     = 204
	idAnswer     = 205
	idClear      = 206
	idStartTray  = 207
	idStatus     = 301
	idTrayShow   = 401
	idTrayToggle = 402
	idTrayExit   = 403
	hotToggle    = 1
	hotAnswer    = 2
	hotExit      = 3
)

var (
	user32              = windows.NewLazySystemDLL("user32.dll")
	gdi32               = windows.NewLazySystemDLL("gdi32.dll")
	kernel32            = windows.NewLazySystemDLL("kernel32.dll")
	shell32             = windows.NewLazySystemDLL("shell32.dll")
	procRegisterClassEx = user32.NewProc("RegisterClassExW")
	procCreateWindowEx  = user32.NewProc("CreateWindowExW")
	procDefWindowProc   = user32.NewProc("DefWindowProcW")
	procGetMessage      = user32.NewProc("GetMessageW")
	procTranslate       = user32.NewProc("TranslateMessage")
	procDispatch        = user32.NewProc("DispatchMessageW")
	procPostQuit        = user32.NewProc("PostQuitMessage")
	procPostMessage     = user32.NewProc("PostMessageW")
	procSendMessage     = user32.NewProc("SendMessageW")
	procShowWindow      = user32.NewProc("ShowWindow")
	procUpdateWindow    = user32.NewProc("UpdateWindow")
	procSetWindowText   = user32.NewProc("SetWindowTextW")
	procEnableWindow    = user32.NewProc("EnableWindow")
	procRegisterHotKey  = user32.NewProc("RegisterHotKey")
	procUnregisterHot   = user32.NewProc("UnregisterHotKey")
	procCreateFont      = gdi32.NewProc("CreateFontW")
	procGetModule       = kernel32.NewProc("GetModuleHandleW")
	procMessageBox      = user32.NewProc("MessageBoxW")
	procLoadImage       = user32.NewProc("LoadImageW")
	procFindWindow      = user32.NewProc("FindWindowW")
	procSetForeground   = user32.NewProc("SetForegroundWindow")
	procCreatePopupMenu = user32.NewProc("CreatePopupMenu")
	procAppendMenu      = user32.NewProc("AppendMenuW")
	procTrackPopupMenu  = user32.NewProc("TrackPopupMenu")
	procDestroyMenu     = user32.NewProc("DestroyMenu")
	procGetCursorPos    = user32.NewProc("GetCursorPos")
	procRegisterWndMsg  = user32.NewProc("RegisterWindowMessageW")
	procDestroyWindow   = user32.NewProc("DestroyWindow")
	procCreateMutex     = kernel32.NewProc("CreateMutexW")
	procShellNotify     = shell32.NewProc("Shell_NotifyIconW")
	wndProcCB           = windows.NewCallback(wndProc)
	trayIconID          = 1
)

type wndClass struct {
	Size       uint32
	Style      uint32
	WndProc    uintptr
	ClsExtra   int32
	WndExtra   int32
	Instance   windows.Handle
	Icon       windows.Handle
	Cursor     windows.Handle
	Background windows.Handle
	MenuName   *uint16
	ClassName  *uint16
	IconSm     windows.Handle
}

type point struct{ X, Y int32 }
type msg struct {
	HWND    uintptr
	Message uint32
	WParam  uintptr
	LParam  uintptr
	Time    uint32
	Pt      point
}

type app struct {
	mu           sync.Mutex
	hwnd         uintptr
	msgHwnd      uintptr
	inst         uintptr
	quitting     bool
	creatingSink bool
	key          uintptr
	base         uintptr
	model        uintptr
	toggle       uintptr
	detectBtn    uintptr
	answerBtn    uintptr
	status       uintptr
	font         uintptr
	cfg          config.File
	gate         *gate.Gate
	cancel       context.CancelFunc
	boot         sync.Mutex
	port         int
	cmd          *exec.Cmd
	questions    []fill.Question
	targetWS     string
	statusText   string
	startTray    uintptr
	trayReady    bool
	windowHidden bool
	taskbarMsg   uint32
	mutexHandle  uintptr
}

var (
	ui        *app
	sinkClass = utf16("AIQuizFormsSink")
	uiClass   = utf16("AIQuizFormsWindow")
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		cfg = config.Default()
	}
	ui = &app{cfg: cfg.Normalized(), gate: gate.New(cfg.Enabled)}
	if !claimSingleInstance() {
		return
	}
	inst, _, _ := procGetModule.Call(0)
	ui.inst = inst
	if err := registerClass(inst, sinkClass, "AIQuizFormsSink"); err != nil {
		fail(err.Error())
	}
	if err := registerClass(inst, uiClass, "AIQuizFormsWindow"); err != nil {
		fail(err.Error())
	}
	ui.creatingSink = true
	msgHwnd, _, err := procCreateWindowEx.Call(
		0,
		uintptr(unsafe.Pointer(sinkClass)),
		0,
		0,
		0, 0, 0, 0,
		hwndMessage(), 0, inst, 0,
	)
	ui.creatingSink = false
	if msgHwnd == 0 {
		fail("Không tạo được hàng đợi thông báo: " + err.Error())
	}
	ui.msgHwnd = msgHwnd
	if err := ui.createUI(); err != nil {
		fail(err.Error())
	}
	registerKeys(ui.msgHwnd)
	ui.taskbarMsg = registerTaskbarMessage()
	if err := ui.addTray(); err != nil {
		ui.trayReady = false
		ui.setStatus("Không tạo được biểu tượng cạnh đồng hồ. Cửa sổ được giữ lại. " + err.Error() + " " + startupStatus(ui.cfg))
	} else {
		if traylife.ShouldStartHidden(ui.cfg.StartInTray, true) {
			ui.hideToTray()
		}
		ui.setStatus(startupStatus(ui.cfg))
	}
	var m msg
	for {
		r, _, _ := procGetMessage.Call(uintptr(unsafe.Pointer(&m)), 0, 0, 0)
		if int32(r) == -1 {
			ui.note("getmessage-error")
			continue
		}
		if r == 0 {
			if ui.quitting && traylife.EndProcess(true) {
				break
			}
			ui.note("ignored-quit")
			continue
		}
		if m.Message == wmHotkey {
			ui.onHotkey(m.WParam)
			continue
		}
		procTranslate.Call(uintptr(unsafe.Pointer(&m)))
		procDispatch.Call(uintptr(unsafe.Pointer(&m)))
	}
}

func registerClass(inst uintptr, className *uint16, name string) error {
	cls := wndClass{
		Size:       uint32(unsafe.Sizeof(wndClass{})),
		WndProc:    wndProcCB,
		Instance:   windows.Handle(inst),
		Background: windows.Handle(6),
		ClassName:  className,
	}
	if r, _, err := procRegisterClassEx.Call(uintptr(unsafe.Pointer(&cls))); r == 0 {
		return errors.New("Không đăng ký được cửa sổ " + name + ": " + err.Error())
	}
	return nil
}

func hwndMessage() uintptr {
	return ^uintptr(2)
}

func (a *app) createUI() error {
	hwnd, _, err := procCreateWindowEx.Call(
		0,
		uintptr(unsafe.Pointer(uiClass)),
		uintptr(unsafe.Pointer(utf16("Trợ lý điền Google Form"))),
		wsOverlappedWindow|wsVisible,
		uintptr(0x80000000), uintptr(0x80000000), 720, 680,
		0, 0, a.inst, 0,
	)
	if hwnd == 0 {
		return errors.New("Không mở được cửa sổ: " + err.Error())
	}
	a.hwnd = hwnd
	procShowWindow.Call(hwnd, swShow)
	procUpdateWindow.Call(hwnd)
	a.windowHidden = false
	return nil
}

func wndProc(hwnd, message, wparam, lparam uintptr) uintptr {
	switch message {
	case 0x0001: // WM_CREATE
		if ui.creatingSink || hwnd == ui.msgHwnd {
			return 0
		}
		ui.hwnd = hwnd
		ui.createControls(hwnd)
		return 0
	case wmSysCommand:
		if hwnd == ui.hwnd && (wparam&0xFFF0) == scClose {
			ui.requestClose()
			return 0
		}
	case wmCommand:
		if (wparam >> 16) == 0 {
			ui.onCommand(int(wparam & 0xffff))
		}
		return 0
	case wmClose:
		if hwnd == ui.hwnd {
			ui.requestClose()
			return 0
		}
		return 0
	case wmHotkey:
		ui.onHotkey(wparam)
		return 0
	case wmRecreate:
		if ui.hwnd == 0 && !ui.quitting {
			wasHidden := ui.windowHidden
			if err := ui.createUI(); err != nil {
				ui.note("recreate-failed")
			} else if wasHidden {
				ui.hideToTray()
			}
		}
		return 0
	case wmTray:
		ui.onTray(lparam)
		return 0
	case wmAppStatus:
		ui.paintStatus()
		return 0
	case wmDestroy:
		if hwnd == ui.msgHwnd {
			if traylife.EndProcess(ui.quitting) {
				procPostQuit.Call(0)
			}
			return 0
		}
		if hwnd == ui.hwnd {
			ui.hwnd = 0
			if traylife.EndProcess(ui.quitting) {
				return 0
			}
			ui.note("ui-destroyed")
			if ui.msgHwnd != 0 {
				procPostMessage.Call(ui.msgHwnd, wmRecreate, 0, 0)
			}
			return 0
		}
		return 0
	}
	if ui.taskbarMsg != 0 && message == uintptr(ui.taskbarMsg) {
		ui.restoreTrayAfterExplorer()
		return 0
	}
	r, _, _ := procDefWindowProc.Call(hwnd, message, wparam, lparam)
	return r
}

func (a *app) createControls(hwnd uintptr) {
	fontHeight := int32(-18)
	a.font, _, _ = procCreateFont.Call(
		uintptr(fontHeight),
		0, 0, 0, 400,
		0, 0, 0, 1,
		0, 0, 0, 0,
		uintptr(unsafe.Pointer(utf16("Segoe UI"))),
	)
	mkLabel(hwnd, "Khóa Groq (chỉ lưu trên máy này)", 16, 12, 660, 22)
	a.key = mkEdit(hwnd, idKey, 16, 36, 660, 28, esPassword|esAutoHScroll)
	mkLabel(hwnd, "Địa chỉ API", 16, 74, 660, 22)
	a.base = mkEdit(hwnd, idBase, 16, 98, 660, 28, esAutoHScroll)
	mkLabel(hwnd, "Mô hình", 16, 136, 660, 22)
	a.model = mkEdit(hwnd, idModel, 16, 160, 660, 28, esAutoHScroll)
	a.startTray = mk(hwnd, "BUTTON", "Khởi động thu nhỏ xuống khay", wsChild|wsVisible|wsTabStop|0x0003, 16, 198, 420, 24, idStartTray)
	if a.cfg.StartInTray {
		procSendMessage.Call(a.startTray, 0x00F1, 1, 0)
	}
	mkButton(hwnd, idSave, "Lưu cài đặt", 16, 232, 200, 34)
	mkButton(hwnd, idOpen, "Mở cửa sổ Google Form", 228, 232, 250, 34)
	a.toggle = mkButton(hwnd, idToggle, toggleText(a.cfg.Enabled), 16, 276, 300, 34)
	a.detectBtn = mkButton(hwnd, idDetect, "Tìm câu hỏi", 328, 276, 160, 34)
	a.answerBtn = mkButton(hwnd, idAnswer, "Điền đáp án", 500, 276, 176, 34)
	mkButton(hwnd, idClear, "Xóa trạng thái phát hiện", 16, 320, 280, 34)
	a.status = mkEdit(hwnd, idStatus, 16, 366, 660, 230, esMultiline|esReadOnly|esAutoVScroll|wsVScroll)
	setText(a.key, a.cfg.APIKey)
	setText(a.base, a.cfg.BaseURL)
	setText(a.model, a.cfg.Model)
	a.applyEnabledButtons()
	for _, h := range []uintptr{a.key, a.base, a.model, a.startTray, a.toggle, a.detectBtn, a.answerBtn, a.status} {
		procSendMessage.Call(h, wmSetFont, a.font, 1)
	}
}

func (a *app) onCommand(id int) {
	switch id {
	case idSave:
		a.cfg = a.readForm()
		if err := a.cfg.Save(); err != nil {
			a.setStatus("Không lưu được cài đặt.")
			return
		}
		a.setStatus("Đã lưu cài đặt trên máy này. Khóa không được ghi ra nhật ký.")
	case idToggle:
		a.toggleEnabled()
	case idOpen:
		go a.openBrowser()
	case idDetect:
		cfg := a.currentConfig()
		go a.runDetect(cfg)
	case idAnswer:
		cfg := a.currentConfig()
		go a.runAnswer(cfg)
	case idClear:
		go a.clearState()
	case idTrayShow:
		a.showFromTray()
	case idTrayToggle:
		a.toggleEnabled()
	case idTrayExit:
		a.exitApp()
	}
}

func (a *app) currentConfig() config.File {
	if a.hwnd == 0 || a.key == 0 {
		return a.cfg.Normalized()
	}
	return a.readForm()
}

func (a *app) readForm() config.File {
	cfg := a.cfg
	cfg.APIKey = getText(a.key)
	cfg.BaseURL = getText(a.base)
	cfg.Model = getText(a.model)
	cfg.Enabled = a.gate.Enabled()
	cfg.StartInTray = a.startTrayChecked()
	a.cfg = cfg.Normalized()
	setText(a.base, a.cfg.BaseURL)
	setText(a.model, a.cfg.Model)
	return a.cfg
}

func (a *app) toggleEnabled() {
	if a.gate.Enabled() {
		a.gate.Disable()
		a.stopWork()
		a.cfg.Enabled = false
	} else {
		a.gate.Enable()
		a.cfg.Enabled = true
	}
	a.cfg.StartInTray = a.startTrayChecked()
	_ = a.cfg.Save()
	setText(a.toggle, toggleText(a.cfg.Enabled))
	a.applyEnabledButtons()
	if a.cfg.Enabled {
		a.setStatus("Đã bật. Alt+Q điền đáp án. Tắt không hoàn tiền cho yêu cầu đã gửi đi.")
	} else {
		a.setStatus("Đã tắt. Không gọi API mới và không điền câu trả lời đang chờ. Ô đã điền giữ nguyên. Đây không phải là gỡ ứng dụng.")
	}
}

func (a *app) applyEnabledButtons() {
	on := uintptr(0)
	if a.gate.Enabled() {
		on = 1
	}
	procEnableWindow.Call(a.detectBtn, on)
	procEnableWindow.Call(a.answerBtn, on)
}

func (a *app) openBrowser() {
	if err := a.ensureBrowser(true); err != nil {
		a.setStatus(config.Redact(err.Error(), a.cfg.APIKey))
		return
	}
	a.setStatus("Đã mở cửa sổ trình duyệt riêng. Hãy tự đăng nhập Google nếu được hỏi, rồi mở đúng bài Google Form. Công cụ không vượt đăng nhập.")
}

func (a *app) runDetect(cfg config.File) {
	if !a.gate.Enabled() {
		a.setStatus("Công cụ đang tắt.")
		return
	}
	if err := a.ensureBrowser(false); err != nil {
		a.setStatus(config.Redact(err.Error(), cfg.APIKey))
		return
	}
	target, err := a.formTarget()
	if err != nil {
		a.setStatus(err.Error())
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	if err := a.inject(ctx, target.WebSocketDebuggerURL); err != nil {
		a.setStatus("Không đọc được trang: " + config.Redact(err.Error(), cfg.APIKey))
		return
	}
	raw, err := browser.Evaluate(ctx, target.WebSocketDebuggerURL, "globalThis.__AIA_DESKTOP_API__.detect()")
	if err != nil {
		a.setStatus("Không tìm được câu hỏi: " + config.Redact(err.Error(), cfg.APIKey))
		return
	}
	var detected struct {
		Count     int             `json:"count"`
		Questions []fill.Question `json:"questions"`
	}
	if err := json.Unmarshal(raw, &detected); err != nil {
		a.setStatus("Kết quả tìm câu hỏi không hợp lệ.")
		return
	}
	a.mu.Lock()
	a.questions = detected.Questions
	a.targetWS = target.WebSocketDebuggerURL
	a.mu.Unlock()
	a.setStatus(fmt.Sprintf("Tìm thấy %d câu hỏi trên trang Google Form này. Chưa điền và chưa bấm Gửi/Tiếp.", detected.Count))
}

func (a *app) runAnswer(cfg config.File) {
	gen, ok := a.gate.Begin()
	if !ok {
		a.setStatus("Công cụ đang tắt. Không gọi API.")
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	a.setCancel(cancel)
	defer cancel()
	err := fill.RunFill(ctx, a.gate, gen, func(ctx context.Context) ([]fill.Answer, error) {
		if err := a.ensureBrowser(false); err != nil {
			return nil, err
		}
		target, err := a.formTarget()
		if err != nil {
			return nil, err
		}
		if err := a.inject(ctx, target.WebSocketDebuggerURL); err != nil {
			return nil, err
		}
		raw, err := browser.Evaluate(ctx, target.WebSocketDebuggerURL, "globalThis.__AIA_DESKTOP_API__.detect()")
		if err != nil {
			return nil, err
		}
		var detected struct {
			Questions []fill.Question `json:"questions"`
		}
		if err := json.Unmarshal(raw, &detected); err != nil {
			return nil, err
		}
		if len(detected.Questions) == 0 {
			return nil, errors.New("không có câu hỏi để điền")
		}
		a.mu.Lock()
		a.questions = detected.Questions
		a.targetWS = target.WebSocketDebuggerURL
		a.mu.Unlock()
		if !a.gate.Allow(gen) {
			return nil, fill.ErrStale
		}
		return (&groq.Client{}).Answer(ctx, cfg, detected.Questions)
	}, func(answers []fill.Answer) error {
		target, err := a.formTarget()
		if err != nil {
			return err
		}
		payload, err := json.Marshal(map[string]any{"answers": answers})
		if err != nil {
			return err
		}
		raw, err := browser.Evaluate(ctx, target.WebSocketDebuggerURL, "globalThis.__AIA_DESKTOP_API__.answer("+string(payload)+")")
		if err != nil {
			return err
		}
		var result struct {
			OK bool `json:"ok"`
		}
		if err := json.Unmarshal(raw, &result); err != nil {
			return err
		}
		if !result.OK {
			return errors.New("một số đáp án không khớp với các lựa chọn")
		}
		return nil
	})
	if err == nil {
		a.setStatus("Đã điền các đáp án hợp lệ. Công cụ không bấm Gửi hoặc Tiếp. Hãy tự kiểm tra trước khi gửi.")
		return
	}
	if errors.Is(err, fill.ErrOff) || errors.Is(err, fill.ErrStale) || errors.Is(err, context.Canceled) {
		a.setStatus("Đã bỏ câu trả lời này vì công cụ đang tắt hoặc bạn vừa tắt. Không hoàn phí nếu nhà cung cấp đã nhận yêu cầu.")
		return
	}
	a.setStatus(config.Redact(err.Error(), cfg.APIKey))
}

func (a *app) clearState() {
	a.mu.Lock()
	ws := a.targetWS
	a.questions = nil
	a.mu.Unlock()
	if ws != "" {
		ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
		_, _ = browser.Evaluate(ctx, ws, "globalThis.__AIA_DESKTOP_API__ && globalThis.__AIA_DESKTOP_API__.clear()")
		cancel()
	}
	a.setStatus("Đã xóa danh sách câu hỏi trong công cụ. Các ô đã điền trên trang giữ nguyên.")
}

func (a *app) ensureBrowser(openHome bool) error {
	a.boot.Lock()
	defer a.boot.Unlock()
	dir, err := config.Dir()
	if err != nil {
		return err
	}
	a.mu.Lock()
	port := a.port
	a.mu.Unlock()
	if port == 0 {
		if saved, err := os.ReadFile(filepath.Join(dir, "debug-port.txt")); err == nil {
			if p, err := strconv.Atoi(strings.TrimSpace(string(saved))); err == nil {
				port = p
			}
		}
	}
	if port != 0 {
		ctx, cancel := context.WithTimeout(context.Background(), 800*time.Millisecond)
		err := browser.WaitReady(ctx, port)
		cancel()
		if err == nil {
			a.mu.Lock()
			a.port = port
			a.mu.Unlock()
			return nil
		}
	}
	exe, err := browser.FindBrowser(browser.DefaultCandidates(), fileExists)
	if err != nil {
		return err
	}
	profile := filepath.Join(dir, "browser-profile")
	if err := os.MkdirAll(profile, 0o700); err != nil {
		return err
	}
	port, err = browser.FreePort()
	if err != nil {
		return err
	}
	openURL := ""
	if openHome {
		openURL = "https://docs.google.com/forms/"
	}
	cmd := exec.Command(exe, browser.LaunchArgs(profile, port, openURL)...)
	if err := cmd.Start(); err != nil {
		return err
	}
	go func() { _ = cmd.Wait() }()
	ctx, cancel := context.WithTimeout(context.Background(), 25*time.Second)
	defer cancel()
	if err := browser.WaitReady(ctx, port); err != nil {
		return errors.New("trình duyệt đã mở nhưng công cụ chưa kết nối được. Hãy thử lại.")
	}
	a.mu.Lock()
	a.cmd = cmd
	a.port = port
	a.mu.Unlock()
	_ = os.WriteFile(filepath.Join(dir, "debug-port.txt"), []byte(strconv.Itoa(port)), 0o600)
	return nil
}

func (a *app) formTarget() (*browser.Target, error) {
	a.mu.Lock()
	port := a.port
	a.mu.Unlock()
	if port == 0 {
		return nil, errors.New("hãy bấm Mở cửa sổ Google Form trước")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()
	targets, err := browser.ListTargets(ctx, port)
	if err != nil {
		return nil, errors.New("không đọc được cửa sổ trình duyệt riêng")
	}
	target := browser.PickFormTarget(targets)
	if target == nil || !forms.IsGoogleForm(target.URL) {
		return nil, errors.New("hãy mở đúng một trang Google Form trong cửa sổ trình duyệt của công cụ. Công cụ không đọc trang khác.")
	}
	return target, nil
}

func (a *app) inject(ctx context.Context, ws string) error {
	_, err := browser.Evaluate(ctx, ws, pagejs.Script())
	return err
}

func (a *app) setCancel(cancel context.CancelFunc) {
	a.mu.Lock()
	if a.cancel != nil {
		a.cancel()
	}
	a.cancel = cancel
	a.mu.Unlock()
}

func (a *app) stopWork() {
	a.mu.Lock()
	cancel := a.cancel
	a.cancel = nil
	a.mu.Unlock()
	if cancel != nil {
		cancel()
	}
}

func (a *app) setStatus(text string) {
	a.mu.Lock()
	a.statusText = text
	hwnd := a.hwnd
	a.mu.Unlock()
	if hwnd != 0 {
		procPostMessage.Call(hwnd, wmAppStatus, 0, 0)
	}
}

func (a *app) paintStatus() {
	a.mu.Lock()
	text := a.statusText
	h := a.status
	a.mu.Unlock()
	setText(h, text)
}

func startupStatus(cfg config.File) string {
	state := "Đang bật"
	if !cfg.Enabled {
		state = "Đang tắt"
	}
	return state + ". Dán khóa Groq vào ô mật, bấm Lưu cài đặt, rồi Mở cửa sổ Google Form. " +
		"Bạn tự đăng nhập Google trong cửa sổ đó nếu cần. Alt+Shift+Q bật/tắt. Alt+Q điền đáp án. " +
		"Bấm phím 1 ở hàng trên (không phải phím số cạnh mũi tên) để thoát hẳn, kể cả khi cửa sổ đang ẩn. " +
		"Bấm X để ẩn xuống khay cạnh đồng hồ; chuột phải biểu tượng để chọn Thoát. " +
		"Nếu phím đã bị chương trình khác giữ, hãy dùng các nút. Công cụ không tự bấm Gửi hoặc Tiếp."
}

func toggleText(on bool) string {
	if on {
		return "Đang bật — bấm để tắt"
	}
	return "Đang tắt — bấm để bật"
}

func hotkeyMods(hk traylife.Hotkey) uintptr {
	var mods uintptr
	if hk.Alt {
		mods |= modAlt
	}
	if hk.Shift {
		mods |= modShift
	}
	if hk.Ctrl {
		mods |= modControl
	}
	return mods
}

func registerKeys(hwnd uintptr) {
	var blocked []string
	for _, hk := range traylife.Hotkeys() {
		ok, _, _ := procRegisterHotKey.Call(hwnd, uintptr(hk.ID), hotkeyMods(hk), uintptr(hk.VK))
		if ok == 0 {
			blocked = append(blocked, hk.Label)
		}
	}
	if len(blocked) == 0 {
		return
	}
	ui.note("hotkey-conflict")
	ui.setStatus(startupStatus(ui.cfg) + " Windows không nhận phím tắt: " + strings.Join(blocked, ", ") + ". Menu khay Thoát vẫn dùng được. Phím số (numpad) không được đăng ký.")
}

func unregisterAllHotkeys(hwnd uintptr) {
	for _, id := range traylife.ReleaseIDs() {
		procUnregisterHot.Call(hwnd, uintptr(id))
	}
}

type notifyIconData struct {
	CbSize            uint32
	HWnd              uintptr
	UID               uint32
	UFlags            uint32
	UCallbackMessage  uint32
	HIcon             uintptr
	SzTip             [128]uint16
	DwState           uint32
	DwStateMask       uint32
	SzInfo            [256]uint16
	UTimeoutOrVersion uint32
	SzInfoTitle       [64]uint16
	DwInfoFlags       uint32
	GuidItem          [16]byte
	HBalloonIcon      uintptr
}

func (a *app) trayData() notifyIconData {
	data := notifyIconData{
		CbSize:           uint32(unsafe.Sizeof(notifyIconData{})),
		HWnd:             a.msgHwnd,
		UID:              uint32(trayIconID),
		UFlags:           nifMessage | nifIcon | nifTip,
		UCallbackMessage: wmTray,
	}
	tip, err := windows.UTF16FromString("Trợ lý điền Google Form")
	if err == nil {
		copy(data.SzTip[:], tip)
	}
	return data
}

func (a *app) addTray() error {
	icon, _, _ := procLoadImage.Call(0, idiApplication, imageIcon, 0, 0, lrShared)
	if icon == 0 {
		return errors.New("không lấy được biểu tượng chuẩn của Windows")
	}
	data := a.trayData()
	data.HIcon = icon
	ok, _, callErr := procShellNotify.Call(nimAdd, uintptr(unsafe.Pointer(&data)))
	if ok == 0 {
		if callErr != nil && callErr.Error() != "The operation completed successfully." {
			return errors.New("Shell_NotifyIcon thêm khay thất bại")
		}
		return errors.New("Shell_NotifyIcon thêm khay thất bại")
	}
	data.UTimeoutOrVersion = notifyIconVersion4
	_, _, _ = procShellNotify.Call(nimSetVersion, uintptr(unsafe.Pointer(&data)))
	a.trayReady = true
	return nil
}

func (a *app) removeTray() {
	if !a.trayReady || a.hwnd == 0 {
		return
	}
	data := a.trayData()
	_, _, _ = procShellNotify.Call(nimDelete, uintptr(unsafe.Pointer(&data)))
	a.trayReady = false
}

func (a *app) requestClose() {
	if a.hwnd != 0 && a.key != 0 {
		a.cfg = a.readForm()
	}
	switch traylife.DecideClose(a.trayReady) {
	case traylife.HideToTray:
		a.hideToTray()
		a.note("close-hide")
	default:
		a.note("close-keep-window")
		a.keepWindowBecauseTrayFailed()
	}
}

func (a *app) hideToTray() {
	if a.hwnd == 0 {
		a.windowHidden = true
		return
	}
	procShowWindow.Call(a.hwnd, swHide)
	a.windowHidden = true
}

func (a *app) showFromTray() {
	if a.hwnd == 0 {
		if err := a.createUI(); err != nil {
			a.note("recreate-failed")
			return
		}
	}
	procShowWindow.Call(a.hwnd, swRestore)
	procShowWindow.Call(a.hwnd, swShow)
	procSetForeground.Call(a.hwnd)
	a.windowHidden = false
	a.note("show-window")
}

func (a *app) keepWindowBecauseTrayFailed() {
	procShowWindow.Call(a.hwnd, swShow)
	a.windowHidden = false
	answer, _, _ := procMessageBox.Call(
		a.hwnd,
		uintptr(unsafe.Pointer(utf16("Không tạo được biểu tượng cạnh đồng hồ, nên cửa sổ không được ẩn. Bấm Có để giữ cửa sổ. Bấm Không để thoát hẳn."))),
		uintptr(unsafe.Pointer(utf16("Trợ lý Google Form"))),
		mbYesNo,
	)
	if answer != idYes {
		a.exitApp()
	}
}

func (a *app) exitApp() {
	if a.quitting {
		return
	}
	a.quitting = true
	a.note("exit")
	a.gate.Invalidate()
	a.stopWork()
	a.removeTray()
	unregisterAllHotkeys(a.msgHwnd)
	if a.hwnd != 0 {
		procDestroyWindow.Call(a.hwnd)
	}
	if a.msgHwnd != 0 {
		procDestroyWindow.Call(a.msgHwnd)
	}
	procPostQuit.Call(0)
}

func (a *app) onHotkey(id uintptr) {
	if a.quitting {
		return
	}
	switch traylife.ActionFor(int(id)) {
	case "toggle":
		a.note("hotkey-toggle")
		a.onCommand(idToggle)
	case "answer":
		a.note("hotkey-answer")
		a.onCommand(idAnswer)
	case "exit":
		a.note("hotkey-exit")
		a.exitApp()
	}
}

func (a *app) note(event string) {
	dir, err := config.Dir()
	if err != nil {
		return
	}
	_ = diag.Append(dir, event, a.cfg.APIKey)
}

func (a *app) onTray(lparam uintptr) {
	event := lparam & 0xFFFF
	switch event {
	case wmLButtonDblClk:
		a.showFromTray()
	case wmContextMenu, wmRButtonUp:
		a.showTrayMenu()
	}
}

func (a *app) showTrayMenu() {
	menu, _, _ := procCreatePopupMenu.Call()
	if menu == 0 {
		a.showFromTray()
		return
	}
	defer procDestroyMenu.Call(menu)
	appendItem(menu, idTrayShow, "Hiện cửa sổ")
	if a.gate.Enabled() {
		appendItem(menu, idTrayToggle, "Đang bật — chọn để tắt")
	} else {
		appendItem(menu, idTrayToggle, "Đang tắt — chọn để bật")
	}
	procAppendMenu.Call(menu, mfSeparator, 0, 0)
	appendItem(menu, idTrayExit, "Thoát (phím 1 hàng trên)")
	procSetForeground.Call(a.hwnd)
	var pt point
	procGetCursorPos.Call(uintptr(unsafe.Pointer(&pt)))
	cmd, _, _ := procTrackPopupMenu.Call(
		menu,
		tpmRightAlign|tpmBottomAlign|tpmReturnCmd|tpmNoNotify,
		uintptr(pt.X), uintptr(pt.Y),
		0, a.hwnd, 0,
	)
	procPostMessage.Call(a.hwnd, 0, 0, 0)
	if cmd != 0 {
		a.onCommand(int(cmd))
	}
}

func (a *app) restoreTrayAfterExplorer() {
	if !a.trayReady && !a.windowHidden {
		return
	}
	a.trayReady = false
	if err := a.addTray(); err != nil || !a.trayReady {
		a.trayReady = false
		if traylife.MustShowAfterTrayLoss(a.windowHidden, false) {
			a.showFromTray()
			a.setStatus("Windows vừa khởi động lại khay đồng hồ và biểu tượng chưa tạo lại được. Cửa sổ được hiện ra.")
		}
		return
	}
	if traylife.MustShowAfterTrayLoss(a.windowHidden, true) {
		a.showFromTray()
	}
}

func appendItem(menu uintptr, id int, text string) {
	procAppendMenu.Call(menu, mfString, uintptr(id), uintptr(unsafe.Pointer(utf16(text))))
}

func claimSingleInstance() bool {
	name := utf16(`Local\AIQuizForms`)
	handle, _, errno := procCreateMutex.Call(0, 0, uintptr(unsafe.Pointer(name)))
	if handle == 0 {
		fail("Không tạo được khóa một phiên bản.")
	}
	ui.mutexHandle = handle
	if errno == syscall.Errno(errorAlreadyExists) {
		hwnd, _, _ := procFindWindow.Call(uintptr(unsafe.Pointer(uiClass)), 0)
		switch traylife.SecondInstance(hwnd != 0) {
		case traylife.ShowExistingWindow:
			procShowWindow.Call(hwnd, swRestore)
			procSetForeground.Call(hwnd)
		default:
			procMessageBox.Call(0,
				uintptr(unsafe.Pointer(utf16("Trợ lý điền Google Form đang chạy. Hãy nhìn biểu tượng cạnh đồng hồ, hoặc kết thúc tiến trình cũ trong Task Manager trước khi mở bản mới."))),
				uintptr(unsafe.Pointer(utf16("Trợ lý Google Form"))),
				0x40,
			)
		}
		return false
	}
	return true
}

func registerTaskbarMessage() uint32 {
	msg, _, _ := procRegisterWndMsg.Call(uintptr(unsafe.Pointer(utf16("TaskbarCreated"))))
	return uint32(msg)
}

func (a *app) startTrayChecked() bool {
	if a.startTray == 0 {
		return a.cfg.StartInTray
	}
	checked, _, _ := procSendMessage.Call(a.startTray, 0x00F0, 0, 0)
	return checked == 1
}

func fileExists(path string) bool {
	info, err := os.Stat(path)
	return err == nil && !info.IsDir()
}

func mkLabel(parent uintptr, text string, x, y, w, h int) uintptr {
	return mk(parent, "STATIC", text, wsChild|wsVisible, x, y, w, h, 0)
}

func mkEdit(parent uintptr, id int, x, y, w, h int, extra uintptr) uintptr {
	return mk(parent, "EDIT", "", wsChild|wsVisible|wsTabStop|wsBorder|extra, x, y, w, h, id)
}

func mkButton(parent uintptr, id int, text string, x, y, w, h int) uintptr {
	return mk(parent, "BUTTON", text, wsChild|wsVisible|wsTabStop, x, y, w, h, id)
}

func mk(parent uintptr, class, text string, style uintptr, x, y, w, h, id int) uintptr {
	hwnd, _, _ := procCreateWindowEx.Call(
		0,
		uintptr(unsafe.Pointer(utf16(class))),
		uintptr(unsafe.Pointer(utf16(text))),
		style,
		uintptr(x), uintptr(y), uintptr(w), uintptr(h),
		parent, uintptr(id), 0, 0,
	)
	if ui != nil && ui.font != 0 {
		procSendMessage.Call(hwnd, wmSetFont, ui.font, 1)
	}
	return hwnd
}

func setText(hwnd uintptr, text string) {
	if hwnd == 0 {
		return
	}
	procSendMessage.Call(hwnd, wmSetText, 0, uintptr(unsafe.Pointer(utf16(text))))
}

func getText(hwnd uintptr) string {
	if hwnd == 0 {
		return ""
	}
	n, _, _ := procSendMessage.Call(hwnd, wmGetTextLength, 0, 0)
	buf := make([]uint16, n+1)
	procSendMessage.Call(hwnd, wmGetText, n+1, uintptr(unsafe.Pointer(&buf[0])))
	return windows.UTF16ToString(buf)
}

func utf16(s string) *uint16 {
	p, err := windows.UTF16PtrFromString(s)
	if err != nil {
		p, _ = windows.UTF16PtrFromString("")
	}
	return p
}

func fail(msg string) {
	procMessageBox.Call(0, uintptr(unsafe.Pointer(utf16(msg))), uintptr(unsafe.Pointer(utf16("Trợ lý Google Form"))), 0x10)
	os.Exit(1)
}
