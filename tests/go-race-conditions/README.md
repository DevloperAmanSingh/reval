# Go Race Conditions Test

This Go file contains **13 different race conditions** that should be detected by AI code reviewers.

## Race Conditions Present

### 1. **Global Variable Race**
```go
var globalCounter int  // Line 7
globalCounter++        // Line 61 - Race condition
```

### 2. **Unprotected Map Access**
```go
var sharedMap = make(map[string]int)  // Line 10
sharedMap[key] = sharedMap[key] + 1   // Line 58 - Race condition
```

### 3. **Bank Account Balance (No Mutex)**
```go
func (b *BankAccount) Deposit(amount int) {
    b.balance += amount  // Line 17 - Race condition
}
```

### 4. **Bank Account Withdraw (Read-Modify-Write)**
```go
func (b *BankAccount) Withdraw(amount int) int {
    if b.balance >= amount {  // Line 24 - Race condition
        b.balance -= amount   // Line 25 - Race condition
        return amount
    }
    return 0
}
```

### 5. **Bank Account GetBalance (No Sync Read)**
```go
func (b *BankAccount) GetBalance() int {
    return b.balance  // Line 32 - Race condition
}
```

### 6. **Counter Increment (No Atomic)**
```go
func (c *Counter) Increment() {
    c.value++  // Line 40 - Race condition
}
```

### 7. **Counter GetValue (No Sync Read)**
```go
func (c *Counter) GetValue() int {
    return c.value  // Line 45 - Race condition
}
```

### 8. **Shared Counter Access**
```go
counter.Increment()  // Line 52 - Multiple goroutines
```

### 9. **Shared Map Modification**
```go
sharedMap[key] = sharedMap[key] + 1  // Line 58 - Race condition
```

### 10. **Concurrent Banking Operations**
```go
account.Deposit(10)   // Line 61 - Race condition
account.Withdraw(5)   // Line 62 - Race condition
```

### 11. **Global Counter Modification**
```go
globalCounter++  // Line 65 - Race condition
```

### 12. **Reading Balance During Modification**
```go
balance := account.GetBalance()  // Line 68 - Race condition
```

### 13. **Map Iteration During Modification**
```go
for key, value := range sharedMap {  // Lines 78-81 - Race condition
    fmt.Printf("%s: %d\n", key, value)
}
```

## How to Run

```bash
go run race_conditions.go
```

## Expected AI Reviewer Feedback

A good AI reviewer should detect all these race conditions and suggest:

1. **Mutex protection** for shared variables
2. **sync.Mutex** or **sync.RWMutex** usage
3. **Atomic operations** for simple counters
4. **Proper synchronization** patterns
5. **Channel-based communication** as alternatives

## Test Your AI Reviewer

Use this file to test if your AI reviewer can:
- ✅ Detect race conditions
- ✅ Understand Go concurrency patterns
- ✅ Suggest proper synchronization
- ✅ Provide specific line number references
