# words comparison (maxChars=150)

## greeting: Hi there! How are you today?

**words-greedy** — end, 7 steps, 33289 tok, 2s

```
i'm fine thanks how are you
```

**words-rerank** — end, 10 steps, 60363 tok, 7s

```
hi there i'm fine thanks how are you?
```

## fact: What is the capital of Japan?

**words-greedy** — end, 5 steps, 26771 tok, 3s

```
it's the tokyo.
```

**words-rerank** — end, 4 steps, 24734 tok, 4s

```
it's tokyo.
```

## count: Count from 1 to 5, separated by commas.

**words-greedy** — end, 10 steps, 52751 tok, 4s

```
1, 2, 3, 4, 5
```

**words-rerank** — end, 10 steps, 59143 tok, 6s

```
1, 2, 3, 4, 5
```

## poem: Write a two-line poem about the sea.

**words-greedy** — end, 23 steps, 181447 tok, 16s

```
sure i'll write a poem about the sea:
sea is an azure and the sea.
```

**words-rerank** — end, 20 steps, 196501 tok, 27s

```
sure i'll write a poem about the sea:
the sea is an azure and an azure.
```

## code: Write a Python function that returns the square of a number.

**words-greedy** — end, 11 steps, 54087 tok, 4s

```
def square (x): return x * x
```

**words-rerank** — end, 11 steps, 71832 tok, 10s

```
def square (x): return x * x
```

## yesno: Is the sun a star? Answer yes or no.

**words-greedy** — end, 2 steps, 8263 tok, 1s

```
yes
```

**words-rerank** — end, 2 steps, 9502 tok, 1s

```
yes
```

Total input tokens: 778683 (≈ $0.0327)
