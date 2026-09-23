# beam comparison (maxChars=120)

## greeting: Hi there! How are you today?

**beam3-aided** — max_chars, 120 steps, 709290 tok, 42s

```
Hha a h   w   t   w w w www www wwwww www wwwwwwww wwwwwwwwww wwwwwwwwwwwwwwwwwww wwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwww
```

**beam3-pure** — max_chars, 120 steps, 671392 tok, 42s

```
H   A A                                                                                                                 
```

## fact: What is the capital of Japan?

**beam3-aided** — error, 70 steps, 409325 tok, 25s, error: Body is unusable: Body has already been read

```
A A A A A A A A A A A AA A A A A A A A A A A A AAA AA A A A A A A AAAA
```

**beam3-pure** — max_chars, 120 steps, 669942 tok, 41s

```
A                                                                  C                                                    
```

## count: Count from 1 to 5, separated by commas.

**beam3-aided** — end, 10 steps, 53112 tok, 3s

```
1,2,3,4,5
```

**beam3-pure** — end, 9 steps, 47054 tok, 3s

```
1,23,455
```

## poem: Write a two-line poem about the sea.

**beam3-aided** — max_chars, 120 steps, 707359 tok, 42s

```
Wa a a a aa a aa a a aaa a  a a  aaa a aa a a aa a  a  a aaaa aa a  aa a a a aaa a aa a a a a a aa aa a a a aaa a a a aa
```

**beam3-pure** — max_chars, 120 steps, 670456 tok, 42s

```
W A                                                                                                                     
```

## code: Write a Python function that returns the square of a number.

**beam3-aided** — end, 12 steps, 64796 tok, 4s

```
f(x)
= x*x

```

**beam3-pure** — max_chars, 120 steps, 674346 tok, 41s

```
f(x)=:
 





















 














































 







 
 





 




 




 
 









```

## yesno: Is the sun a star? Answer yes or no.

**beam3-aided** — end, 2 steps, 8012 tok, 1s

```
Y
```

**beam3-pure** — end, 2 steps, 7681 tok, 1s

```
Y
```

Total input tokens: 4692765 (≈ $0.1971)
