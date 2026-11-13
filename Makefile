.PHONY: install mock dev check test e2e perf

install:
	npm install
	npx playwright install chromium || PLAYWRIGHT_HOST_PLATFORM_OVERRIDE=mac14-arm64 npx playwright install chromium

mock:
	npm run mock

dev:
	npm run dev

check:
	npm run check

test:
	npm run test

e2e:
	npm run e2e

perf:
	@echo "не реализовано: perf" >&2; exit 1
