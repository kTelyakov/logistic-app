.PHONY: install mock dev check test e2e perf

install:
	npm install

mock:
	@echo "не реализовано: mock-server" >&2; exit 1

dev:
	npm run dev

check:
	npm run typecheck

test:
	@echo "не реализовано: sync-core, tests-unit-e2e" >&2; exit 1

e2e:
	@echo "не реализовано: e2e-foundation, tests-unit-e2e" >&2; exit 1

perf:
	@echo "не реализовано: perf" >&2; exit 1
