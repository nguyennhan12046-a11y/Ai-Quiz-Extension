package status

import (
	"context"
	"errors"
)

const (
	NoKey       = "no-key"
	Network     = "api-network"
	Timeout     = "api-timeout"
	HTTP        = "api-http"
	Parse       = "api-parse"
	NoForm      = "no-form"
	NoQuestions = "no-questions"
	NoMatch     = "no-match"
	Browser     = "browser"
	Generic     = "error"
)

type Error struct {
	Code string
}

func (e *Error) Error() string {
	if e == nil || e.Code == "" {
		return Generic
	}
	return e.Code
}

func Err(code string) error {
	return &Error{Code: code}
}

func CodeOf(err error) string {
	if err == nil {
		return ""
	}
	var coded *Error
	if errors.As(err, &coded) && coded.Code != "" {
		return coded.Code
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return Timeout
	}
	return Generic
}

func PublicText(err error) string {
	switch CodeOf(err) {
	case NoKey:
		return "Chưa có khóa Groq. Chưa gọi API và chưa điền."
	case Network:
		return "Không kết nối được API. Chưa điền."
	case Timeout:
		return "API quá thời gian chờ. Chưa điền."
	case HTTP:
		return "API từ chối yêu cầu. Chưa điền."
	case Parse:
		return "API trả dữ liệu không đọc được. Chưa điền."
	case NoForm:
		return "Chưa mở trang Google Form trong cửa sổ của công cụ. Chưa điền."
	case NoQuestions:
		return "Không thấy câu hỏi trên trang này. Chưa điền."
	case NoMatch:
		return "Đáp án không khớp lựa chọn. Chưa điền hết."
	case Browser:
		return "Không mở được Edge hoặc Chrome. Cửa sổ công cụ vẫn ở đây."
	default:
		return "Có lỗi. Chưa điền."
	}
}
