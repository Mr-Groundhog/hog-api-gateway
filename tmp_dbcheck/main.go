package main

import (
	"database/sql"
	"fmt"
	"os"

	_ "github.com/go-sql-driver/mysql"
)

func main() {
	db, err := sql.Open("mysql", "root:root@tcp(127.0.0.1:3306)/")
	if err != nil {
		fmt.Println("open:", err)
		os.Exit(1)
	}
	defer db.Close()
	rows, err := db.Query("SHOW DATABASES")
	if err != nil {
		fmt.Println("query:", err)
		os.Exit(1)
	}
	var dbs []string
	for rows.Next() {
		var name string
		_ = rows.Scan(&name)
		dbs = append(dbs, name)
	}
	rows.Close()
	for _, name := range dbs {
		if name == "information_schema" || name == "mysql" || name == "performance_schema" || name == "sys" {
			continue
		}
		fmt.Println("== db:", name)
		var cnt int
		if err := db.QueryRow("SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=? AND table_name='ai_review_records'", name).Scan(&cnt); err == nil && cnt > 0 {
			_ = db.QueryRow("SELECT COUNT(*) FROM `" + name + "`.ai_review_records").Scan(&cnt)
			fmt.Println("   ai_review_records rows:", cnt)
		} else {
			fmt.Println("   ai_review_records: not found")
		}
		var users, logs int
		_ = db.QueryRow("SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=? AND table_name='users'", name).Scan(&users)
		_ = db.QueryRow("SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=? AND table_name='logs'", name).Scan(&logs)
		if users > 0 {
			_ = db.QueryRow("SELECT COUNT(*) FROM `" + name + "`.users").Scan(&cnt)
			_ = db.QueryRow("SELECT COUNT(*) FROM `" + name + "`.logs").Scan(&logs)
			fmt.Printf("   users=%d logs=%d\n", cnt, logs)
		}
	}
}
