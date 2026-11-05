INSERT INTO "corridors" (
    "id",
    "code",
    "sourceCurrency",
    "targetCurrency",
    "sourceRail",
    "destinationRail",
    "baseSpreadBps",
    "volatilityBufferBps",
    "quoteTtlSeconds",
    "minTransferAmount",
    "maxTransferAmount",
    "isActive"
)
VALUES
    (gen_random_uuid(), 'AE_PK', 'AED', 'PKR', 'AANI_UAE', 'RAAST_PK', 30, 8, 60, 10, 100000, true),
    (gen_random_uuid(), 'PK_AE', 'PKR', 'AED', 'RAAST_PK', 'AANI_UAE', 45, 12, 45, 1000, 10000000, true),
    (gen_random_uuid(), 'SA_PK', 'SAR', 'PKR', 'SARIE_KSA', 'RAAST_PK', 35, 8, 60, 10, 100000, true),
    (gen_random_uuid(), 'PK_SA', 'PKR', 'SAR', 'RAAST_PK', 'SARIE_KSA', 45, 12, 45, 1000, 10000000, true)
ON CONFLICT ("code") DO NOTHING;
