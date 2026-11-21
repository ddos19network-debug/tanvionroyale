.\\');\n    }\n    const cryptoScale = offer.cryptoScale ?? 8;\n    const pricePerUnit = offer.pricePerFiatUnit;\n    const cryptoAmount = Math.floor((fiatAmount * Math.pow(10, cryptoScale)) / pricePerUnit);\n    const feeAmount = Math.floor(fiatAmount * 0.005);\n    const totalFiat = fiatAmount + feeAmount;\n    return {\n      symbol,\n      fiat,\n      side,\n      fiatAmount,\n      cryptoAmount,\n      pricePerFiatUnit: pricePerUnit,\n      feeAmount,\n      totalFiat,\n      dataSource: \\'DEMO\\',\n      asOf: new Date().toISOString(),\n    };\n  }';
fs.appendFileSync(path, content);
console.log('Appended');
^Z
