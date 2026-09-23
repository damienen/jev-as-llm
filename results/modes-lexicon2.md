# modes comparison (maxChars=120)

## greeting: Hi there! How are you today?

**greedy-lexicon** — max_chars, 120 steps, 1336868 tok, 43s

```
A am a Is a a a  a                          A  A           Is a a  A  A A A           A  A  A    A A    Is     A A A    
```

## fact: What is the capital of Japan?

**greedy-lexicon** — end, 24 steps, 108722 tok, 8s

```
A Is Capital A  JAPAN  
```

## count: Count from 1 to 5, separated by commas.

**greedy-lexicon** — end, 11 steps, 36683 tok, 4s

```
1,2,3,45,5
```

## poem: Write a two-line poem about the sea.

**greedy-lexicon** — end, 81 steps, 617833 tok, 27s

```
Sea said a as as as 
a as as as as as as as as Sea  A              a a aardvark.
```

## code: Write a Python function that returns the square of a number.

**greedy-lexicon** — max_chars, 120 steps, 1118614 tok, 42s

```
Write a function a a  a a a a a a  a a a a a a a aardvark
Write                                    
 WRITE 













```

## yesno: Is the sun a star? Answer yes or no.

**greedy-lexicon** — end, 4 steps, 13230 tok, 1s

```
Yes
```

Total input tokens: 3231950 (≈ $0.1357)
