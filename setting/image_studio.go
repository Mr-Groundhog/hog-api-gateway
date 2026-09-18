package setting

import (
	"fmt"
	"strconv"
	"strings"
)

// MaxImageStudioDailyLimit is the largest administrator-configurable per-user limit.
const MaxImageStudioDailyLimit = 100000

// ImageStudioDailyLimit controls successful workbench generations per user and day. Zero means unlimited.
var ImageStudioDailyLimit = 0

func ValidateImageStudioDailyLimit(value string) error {
	limit, err := strconv.Atoi(strings.TrimSpace(value))
	if err != nil || limit < 0 || limit > MaxImageStudioDailyLimit {
		return fmt.Errorf("image studio daily limit must be between 0 and %d", MaxImageStudioDailyLimit)
	}
	return nil
}
