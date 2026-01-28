# Unknit Language Specification

## Philosophy

Unknit is a literate programming language designed for high-level code review and documentation. It transforms implementation code into a scannable, hierarchical outline.

### Core Principles

1. **Visual hierarchy** - Python-like indentation for structure
2. **Focus on WHAT, not HOW** - Declarative, conceptual blocks
3. **Language agnostic** - Works for any codebase
4. **Toggleable detail** - IDE extension reveals implementation on demand

---

## Syntax

### Function Definition

```
fn name(param1, param2, optional?) -> return_type | error_type:
```

| Element | Meaning |
|---------|---------|
| `fn` | Function declaration keyword |
| `param` | Required parameter |
| `param?` | Optional parameter |
| `-> type` | Return type |
| `type \| error` | Success or failure return types |

---

### Blocks

| Syntax | Meaning |
|--------|---------|
| `name` | Conceptual block (logical grouping) |
| `name()` | Internal function call (defined in project) |
| `@name()` | External call (library/dependency) |

**Conceptual blocks** group related logic under a single name. They have no implementation - just organization.

**Internal calls** reference functions defined within the project.

**External calls** reference third-party libraries, frameworks, or system calls.

---

### Returns

| Syntax | Meaning |
|--------|---------|
| `*->` | Early exit (error, failure, guard clause) |
| `->` | Final return (end of function) |

Early exits can be combined with calls on a single line:

```
validate_order() *-> errors
```

---

### Error Handling

```
on error: *-> errors
```

Catches exceptions and exits with error.

---

### Structure Rules

- Indentation defines hierarchy (parent/child blocks)
- Each line = one toggleable concept
- No implementation details in unknit file
- Child blocks are indented under parent blocks
- Siblings share the same indentation level

---

## Project Configuration

```yaml
# .unknit.yaml
project:
  python:
    internal_packages: ["src", "app", "lib"]
  javascript:
    internal_packages: ["src", "lib", "components"]
  # Can auto-detect from pyproject.toml / package.json / go.mod
```

Configuration determines which imports are internal (`name()`) vs external (`@name()`).

### Auto-detection

The unknit tool can auto-detect internal packages by:

1. Checking if source file exists in project directory
2. Reading project manifest (pyproject.toml, package.json, go.mod, Cargo.toml)
3. Resolving import paths against filesystem

---

## Complete Example

### Python Source

```python
def process_order(data: dict) -> dict:
    is_valid, validated_data, errors = validate_order(data)
    if not is_valid:
        return {"success": False, "errors": errors}

    items_hash = hash_items(validated_data["items"])
    if check_duplicate_order(validated_data["customer_id"], items_hash):
        return {"success": False, "errors": ["Duplicate order"]}

    pricing = calculate_order_total(
        validated_data["items"],
        validated_data["customer_id"],
        validated_data.get("promo_code")
    )

    availability = check_availability(validated_data["items"])
    if not availability["all_available"]:
        return {"success": False, "errors": ["Items unavailable"]}

    reservation = reserve_items(validated_data["items"])

    try:
        order = create_order_record(validated_data, pricing)
        save_order(order)

        payment_result = process_payment(
            customer_id=validated_data["customer_id"],
            amount=pricing["total"],
            order_id=order["id"]
        )

        if not payment_result["success"]:
            release_reservation(reservation["id"])
            update_order_status(order["id"], "payment_failed")
            return {"success": False, "errors": ["Payment failed"]}

        update_order_status(order["id"], "confirmed")
        send_order_confirmation(validated_data["customer_id"], order)

        return {"success": True, "order": order}

    except Exception as e:
        release_reservation(reservation["id"])
        return {"success": False, "errors": [str(e)]}
```

### Unknit Version

```
fn process_order(data) -> order | errors:
    validate_order() *-> errors
    check_duplicate_order() *-> errors
    calculate_order_total()
    inventory_check
        @check_availability() *-> errors
        @reserve_items()
    order_creation
        create_order_record()
        @save_order()
    payment
        @process_payment() *-> errors
    finalization
        @update_order_status()
        @send_order_confirmation()
    -> order

    on error: *-> errors
```

---

## IDE Integration

### VS Code Extension Behavior

Each line in the unknit file is toggleable:

```
fn process_order(data) -> order | errors:
    validate_order() *-> errors        ▶  [collapsed]
  ▼ inventory_check                       [expanded]
    │  availability = check_availability(validated_data["items"])
    │  if not availability["all_available"]:
    │      return {"success": False, "errors": ["Items unavailable"]}
    │  reservation = reserve_items(validated_data["items"])
    payment                            ▶  [collapsed]
```

- Click to expand/collapse blocks
- Expanded view shows actual implementation code
- Syntax highlighting for both unknit and source language

---

## File Convention

| Extension | Purpose |
|-----------|---------|
| `.unknit` | Unknit specification file |
| `.unknit.yaml` | Project configuration |

Unknit files mirror source structure:

```
src/
  orders/
    processor.py
    processor.unknit
    validation.py
    validation.unknit
```

---

## Grammar Summary

```
file        = fn_def+
fn_def      = "fn" name "(" params? ")" "->" return_type ":" body
params      = param ("," param)*
param       = name "?"?
return_type = type ("|" type)?
body        = (block | call | return | error_handler)+
block       = name body?
call        = "@"? name "()" early_exit?
early_exit  = "*->" name?
return      = "->" name?
error_handler = "on" name ":" early_exit
```
