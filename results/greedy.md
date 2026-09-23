# greedy comparison (maxChars=200)

## greeting: Hi there! How are you today?

**greedy-pure** — max_chars, 200 steps, 413766 tok, 64s

```
H                                                                                                                                                                                                       
```

**greedy-aided** — max_chars, 200 steps, 438740 tok, 64s

```
Hhhh h h h h h h h h h h h h h h h h h hh h h hh h hh h h h h h h h h h h h h h h h h h h h h h h h h h h h h h h h h h hh h h h h h h h h h h h h h hhh h h h h h h h h h hh h h hh h h h h h h h hh h 
```

## fact: What is the capital of Japan?

**greedy-pure** — max_chars, 200 steps, 413566 tok, 64s

```
A                                                                                                                                                                                                       
```

**greedy-aided** — max_chars, 200 steps, 439008 tok, 66s

```
Aa a a A A A A A A A A A A A A A A A A A A A A A A A A A A A a A A A A A A A A A A A A A A A A A AA A A A A A A AA A A A A A A A A A A A A A A A A A A A A A A A A A A A A A A A A A A A A A AA A A A A 
```

## count: Count from 1 to 5, separated by commas.

**greedy-pure** — end, 9 steps, 18666 tok, 3s

```
1,23,4,5
```

**greedy-aided** — end, 10 steps, 21560 tok, 3s

```
1,2,3,4,5
```

## poem: Write a two-line poem about the sea.

**greedy-pure** — max_chars, 200 steps, 413966 tok, 65s

```
W                                                                                                                                                                                                       
```

**greedy-aided** — end, 125 steps, 270779 tok, 41s

```
Wa a aaa aa     a                Wa Wa Wa Wa Wa Wa  Wa  Wa  Wa   Wa Wa Wa Wa Wa Wa Wa Wa Wa Wa  Wa Wa   Wa Wa Wa    Wa  Wa 

```

## code: Write a Python function that returns the square of a number.

**greedy-pure** — max_chars, 200 steps, 416062 tok, 64s

```
f(x)=                                                                                     x      :  




 


































































 


























```

**greedy-aided** — max_chars, 200 steps, 439529 tok, 65s

```
f(x):
 
 
 
 
 
 
 

 
 
 
 
:

 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 

```

## yesno: Is the sun a star? Answer yes or no.

**greedy-pure** — end, 2 steps, 4139 tok, 1s

```
Y
```

**greedy-aided** — end, 2 steps, 4305 tok, 1s

```
Y
```

Total input tokens: 3294086 (≈ $0.1384)
