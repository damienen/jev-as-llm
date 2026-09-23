# modes comparison (maxChars=150)

## greeting: Hi there! How are you today?

**greedy-framed** — max_chars, 150 steps, 325309 tok, 46s

```
Hi                        a                                                    a    a                                                a     a          
```

**greedy-visible** — end, 52 steps, 118432 tok, 16s

```
Hi h        h                       h              
```

## fact: What is the capital of Japan?

**greedy-framed** — end, 126 steps, 274522 tok, 38s

```
Caaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa  
```

**greedy-visible** — end, 25 steps, 55868 tok, 8s

```
AC a a      a  a    a   
```

## count: Count from 1 to 5, separated by commas.

**greedy-framed** — end, 10 steps, 21715 tok, 3s

```
1,2,3,4,5
```

**greedy-visible** — end, 11 steps, 24394 tok, 3s

```
1,23,,4,5,
```

## poem: Write a two-line poem about the sea.

**greedy-framed** — max_chars, 150 steps, 324966 tok, 46s

```
W                                                                                                                                                     
```

**greedy-visible** — end, 8 steps, 17703 tok, 3s

```
Waaa aa
```

## code: Write a Python function that returns the square of a number.

**greedy-framed** — max_chars, 150 steps, 325416 tok, 46s

```
W                                                                                                                                                     
```

**greedy-visible** — end, 28 steps, 62178 tok, 9s

```
W aaaaaaaaaaaaaaaaaaaaaaaaa
```

## yesno: Is the sun a star? Answer yes or no.

**greedy-framed** — end, 2 steps, 4333 tok, 1s

```
Y
```

**greedy-visible** — end, 2 steps, 4425 tok, 1s

```
Y
```

Total input tokens: 1559261 (≈ $0.0655)
