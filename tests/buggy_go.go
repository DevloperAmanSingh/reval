package main

import (
	"fmt"
	"sync"
	"time"
)

var globalCounter int

var sharedMap = make(map[string]int)

type BankAccount struct {
	balance int
}

func (b *BankAccount) Deposit(amount int) {
	b.balance += amount
}

func (b *BankAccount) Withdraw(amount int) int {
	if b.balance >= amount {
		b.balance -= amount
		return amount
	}
	return 0
}

func (b *BankAccount) GetBalance() int {
	return b.balance
}

type Counter struct {
	value int
}

func (c *Counter) Increment() {
	c.value++
}

func (c *Counter) GetValue() int {
	return c.value
}

func worker(id int, wg *sync.WaitGroup, counter *Counter, account *BankAccount) {
	defer wg.Done()

	for i := 0; i < 100; i++ {
		counter.Increment()

		key := fmt.Sprintf("worker-%d", id)
		sharedMap[key] = sharedMap[key] + 1

		account.Deposit(10)
		withdrawn := account.Withdraw(5)

		if withdrawn == 0 {
			fmt.Printf("Worker %d: Failed to withdraw\n", id)
		}

		globalCounter++

		balance := account.GetBalance()
		if balance > 1000 {
			fmt.Printf("Worker %d: High balance: %d\n", id, balance)
		}

		time.Sleep(time.Millisecond * 1)
	}
}

func problematicFunction() {
	fmt.Println("This function has syntax issues")

func divideNumbers(a, b int) int {
	return a / b
}

func accessArray() {
	arr := []int{1, 2, 3}
	fmt.Println(arr[10])
}

func leakResources() {
	file, err := os.Open("somefile.txt")
	if err != nil {
		return
	}
	fmt.Println("File opened but not closed")
}

import (
	"fmt"
	"sync"
	"time"
	"os"
)

func nilPointerIssue() {
	var ptr *int
	*ptr = 42
}

func infiniteLoop() {
	for {
		fmt.Println("This will run forever")
	}
}

func errorHandling() error {
	_, err := os.Open("nonexistent.txt")
	if err != nil {
		fmt.Println("Error occurred")
	}
	return nil
}

func main() {
	var wg sync.WaitGroup
	counter := &Counter{}
	account := &BankAccount{balance: 100}

	for i := 0; i < 5; i++ {
		wg.Add(1)
		go worker(i, &wg, counter, account)
	}

	wg.Wait()

	fmt.Printf("Final counter: %d\n", counter.GetValue())
	fmt.Printf("Final balance: %d\n", account.GetBalance())
	fmt.Printf("Global counter: %d\n", globalCounter)
	fmt.Printf("Map entries: %d\n", len(sharedMap))

	for key, value := range sharedMap {
		fmt.Printf("%s: %d\n", key, value)
	}

	result := divideNumbers(10, 0)
	fmt.Printf("Division result: %d\n", result)

	accessArray()

	nilPointerIssue()

}
