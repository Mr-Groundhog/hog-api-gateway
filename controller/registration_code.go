package controller

import (
	"net/http"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/model"

	"github.com/gin-gonic/gin"
)

func GetAllRegistrationCodes(c *gin.Context) {
	pageInfo := common.GetPageQuery(c)
	codes, total, err := model.GetAllRegistrationCodes(pageInfo.GetStartIdx(), pageInfo.GetPageSize())
	if err != nil {
		common.ApiError(c, err)
		return
	}
	pageInfo.SetTotal(int(total))
	pageInfo.SetItems(codes)
	common.ApiSuccess(c, pageInfo)
}

func SearchRegistrationCodes(c *gin.Context) {
	keyword := c.Query("keyword")
	status := c.Query("status")
	pageInfo := common.GetPageQuery(c)
	codes, total, err := model.SearchRegistrationCodes(keyword, status, pageInfo.GetStartIdx(), pageInfo.GetPageSize())
	if err != nil {
		common.ApiError(c, err)
		return
	}
	pageInfo.SetTotal(int(total))
	pageInfo.SetItems(codes)
	common.ApiSuccess(c, pageInfo)
}

func GetRegistrationCode(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	code, err := model.GetRegistrationCodeById(id)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data":    code,
	})
}

func AddRegistrationCode(c *gin.Context) {
	code := model.RegistrationCode{}
	err := c.ShouldBindJSON(&code)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if utf8.RuneCountInString(code.Name) == 0 || utf8.RuneCountInString(code.Name) > common.MaxRedemptionNameLength {
		common.ApiErrorI18n(c, i18n.MsgRedemptionNameLength)
		return
	}
	if code.Count <= 0 {
		common.ApiErrorI18n(c, i18n.MsgRedemptionCountPositive)
		return
	}
	if code.Count > 100 {
		common.ApiErrorI18n(c, i18n.MsgRedemptionCountMax)
		return
	}
	if valid, msg := validateExpiredTime(c, code.ExpiredTime); !valid {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": msg})
		return
	}
	var keys []string
	for i := 0; i < code.Count; i++ {
		key, err := model.GenerateUniqueRegistrationCodeKey()
		if err != nil {
			common.SysError("failed to generate registration code: " + err.Error())
			c.JSON(http.StatusOK, gin.H{
				"success": false,
				"message": i18n.T(c, i18n.MsgRegistrationCodeCreateFailed),
				"data":    keys,
			})
			return
		}
		cleanCode := model.RegistrationCode{
			UserId:      c.GetInt("id"),
			Name:        code.Name,
			Key:         key,
			Status:      common.RedemptionCodeStatusEnabled,
			CreatedTime: common.GetTimestamp(),
			ExpiredTime: code.ExpiredTime,
		}
		err = cleanCode.Insert()
		if err != nil {
			common.SysError("failed to insert registration code: " + err.Error())
			c.JSON(http.StatusOK, gin.H{
				"success": false,
				"message": i18n.T(c, i18n.MsgRegistrationCodeCreateFailed),
				"data":    keys,
			})
			return
		}
		keys = append(keys, key)
	}
	recordManageAudit(c, "registration_code.create", map[string]interface{}{
		"name":         code.Name,
		"count":        code.Count,
		"expired_time": code.ExpiredTime,
	})
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data":    keys,
	})
}

func DeleteRegistrationCode(c *gin.Context) {
	id, _ := strconv.Atoi(c.Param("id"))
	_, err := model.GetRegistrationCodeById(id)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	err = model.DeleteRegistrationCodeById(id)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
	})
}

func UpdateRegistrationCode(c *gin.Context) {
	statusOnly := c.Query("status_only")
	code := model.RegistrationCode{}
	err := c.ShouldBindJSON(&code)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	cleanCode, err := model.GetRegistrationCodeById(code.Id)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if statusOnly == "" {
		if valid, msg := validateExpiredTime(c, code.ExpiredTime); !valid {
			c.JSON(http.StatusOK, gin.H{"success": false, "message": msg})
			return
		}
		// If you add more fields, please also update RegistrationCode.Update()
		cleanCode.Name = code.Name
		cleanCode.ExpiredTime = code.ExpiredTime
	}
	if statusOnly != "" {
		cleanCode.Status = code.Status
	}
	err = cleanCode.Update()
	if err != nil {
		common.ApiError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data":    cleanCode,
	})
}

func DeleteInvalidRegistrationCode(c *gin.Context) {
	rows, err := model.DeleteInvalidRegistrationCodes()
	if err != nil {
		common.ApiError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data":    rows,
	})
}

// CheckRegistrationCode 供注册页匿名预检注册码是否可用（不消费），带关键速率限制。
func CheckRegistrationCode(c *gin.Context) {
	code := strings.TrimSpace(c.Query("code"))
	valid, reason := model.CheckRegistrationCodeValid(code)
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data": gin.H{
			"valid":  valid,
			"reason": reason,
		},
	})
}
