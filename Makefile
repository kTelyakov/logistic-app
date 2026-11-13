.PHONY: install mock dev check test e2e perf

install:
	npm install

mock:
	npm run mock

dev:
	npm run dev

check:
	npm run typecheck

test:
	npm run test

e2e:
	@echo "не реализовано: e2e-foundation, tests-unit-e2e" >&2; exit 1

perf:
	@echo "не реализовано: perf" >&2; exit 1
