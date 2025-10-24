package goraceconditions
package main

import (
	"fmt"
	"sync"
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

	for i := 0; i < 1000; i++ {
		counter.Increment()
		key := fmt.Sprintf("worker-%d", id)
		sharedMap[key] = sharedMap[key] + 1

		account.Deposit(10)
		account.Withdraw(5)

		globalCounter++

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

	for i := 0; i < 10; i++ {
		wg.Add(1)
		go worker(i, &wg, counter, account)
	}

	wg.Wait()

	fmt.Printf("Final counter value: %d (expected: %d)\n", counter.GetValue(), 10*1000)
	fmt.Printf("Final account balance: %d\n", account.GetBalance())
	fmt.Printf("Global counter: %d\n", globalCounter)
	fmt.Printf("Shared map entries: %d\n", len(sharedMap))

	for key, value := range sharedMap {
		fmt.Printf("%s: %d\n", key, value)
	}
}
