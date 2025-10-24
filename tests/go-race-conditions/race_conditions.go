// Package raceconditions demonstrates various race condition bugs in Go
package main

import (
	"fmt"
	"sync"
	"time"
)

// Global counter - Race condition #1: Unprotected shared variable
var globalCounter int

// Shared data structure - Race condition #2: Map without mutex
var sharedMap = make(map[string]int)

// BankAccount demonstrates race condition in banking operations
type BankAccount struct {
	balance int
}

func (b *BankAccount) Deposit(amount int) {
	// Race condition #3: No mutex protection for balance updates
	b.balance += amount
}

func (b *BankAccount) Withdraw(amount int) int {
	// Race condition #4: Reading and writing without synchronization
	if b.balance >= amount {
		b.balance -= amount
		return amount
	}
	return 0
}

func (b *BankAccount) GetBalance() int {
	// Race condition #5: Reading without synchronization
	return b.balance
}

// Counter with race condition
type Counter struct {
	value int
}

func (c *Counter) Increment() {
	// Race condition #6: No atomic operations
	c.value++
}

func (c *Counter) GetValue() int {
	// Race condition #7: Reading without synchronization
	return c.value
}

// Worker function that causes race conditions
func worker(id int, wg *sync.WaitGroup, counter *Counter, account *BankAccount) {
	defer wg.Done()

	for i := 0; i < 1000; i++ {
		// Race condition #8: Multiple goroutines modifying shared counter
		counter.Increment()

		// Race condition #9: Multiple goroutines accessing shared map
		key := fmt.Sprintf("worker-%d", id)
		sharedMap[key] = sharedMap[key] + 1

		// Race condition #10: Banking operations without locks
		account.Deposit(10)
		account.Withdraw(5)

		// Race condition #11: Global variable access
		globalCounter++

		// Race condition #12: Reading balance while others modify
		balance := account.GetBalance()
		if balance > 1000 {
			fmt.Printf("Worker %d: High balance detected: %d\n", id, balance)
		}
	}
}

func main() {
	var wg sync.WaitGroup
	counter := &Counter{}
	account := &BankAccount{balance: 100}

	// Start multiple goroutines that will race
	for i := 0; i < 10; i++ {
		wg.Add(1)
		go worker(i, &wg, counter, account)
	}

	wg.Wait()

	fmt.Printf("Final counter value: %d (expected: %d)\n", counter.GetValue(), 10*1000)
	fmt.Printf("Final account balance: %d\n", account.GetBalance())
	fmt.Printf("Global counter: %d\n", globalCounter)
	fmt.Printf("Shared map entries: %d\n", len(sharedMap))

	// Race condition #13: Iterating over map while it might be modified
	for key, value := range sharedMap {
		fmt.Printf("%s: %d\n", key, value)
	}
}
