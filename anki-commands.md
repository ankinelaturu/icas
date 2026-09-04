

```
pnpm icas-agent \
  discover \
  --id loan-payoff \
  --url http://localhost:4101 \
  --vendor icas-bank \
  --product icas-bank \
  --tenant icas-bank \
  --goal "Generate a payoff statement for loan 987654 for 2026-09-30" \
  2>&1 | tee icasbank-loan-payoff-discover.log






```
pnpm icas-agent 
  discover \
  --id share-hold \
  --url http://localhost:4103 \
  --vendor helix \
  --product helix \
  --tenant helix-cu \
  --goal "Place a \$250.00 hold on member 441122 share 01 for pending debit card authorization. Extract the hold confirmation number, available balance after the hold, and the hold expiry date." \
   2>&1 | tee helix-cu_discover.log
```

```
pnpm icas-play \
  run share-hold \
  --url http://localhost:4103 \
  --vendor helix \
  --product helix \
  --tenant helix-cu \
  --memberNumber 441122 \
  --holdAmount 250.00 \
  --holdReason "pending debit card authorization"
```