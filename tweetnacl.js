if (typeof Math.imul === 'undefined') {
    Math.imul = function (a, b) {
	var ah = a >>> 16 & 0xFFFF;
	var al = a & 0xFFFF;
	var bh = b >>> 16 & 0xFFFF;
	var bl = b & 0xFFFF;
	// the shift by 0 fixes the sign on the high part
	// the final |0 converts the unsigned value into a signed value
	return al * bl + (ah * bl + al * bh << 16 >>> 0) | 0;
    };
}

function TweetNaclC() {
    ///////////////////////////////////////////////////////////////////////////
    // Randomness

    var randombytes_fill;
    if (typeof module !== 'undefined' && module.exports) {
	// node.js
	randombytes_fill = function (buf) {
	    buf.set(crypto.randomBytes(buf.byteLength));
	};
    } else if (window && window.crypto && window.crypto.getRandomValues) {
	// modernish browser
	randombytes_fill = function (buf) {
	    crypto.getRandomValues(buf);
	};
    } else {
	randombytes_fill = function (buf) {
	    throw { name: "No cryptographic random number generator",
		    message: "Your system does not support cryptographic random number generation." };
	};
    }

    ///////////////////////////////////////////////////////////////////////////
    // Horrifying UTF-8 and hex codecs

    function encode_utf8(s) {
	return encode_latin1(unescape(encodeURIComponent(s)));
    }

    function encode_latin1(s) {
	var result = new Uint8Array(s.length);
	for (var i = 0; i < s.length; i++) {
	    var c = s.charCodeAt(i);
	    if ((c & 0xff) !== c) throw {message: "Cannot encode string in Latin1", str: s};
	    result[i] = (c & 0xff);
	}
	return result;
    }

    function decode_utf8(bs) {
	return decodeURIComponent(escape(decode_latin1(bs)));
    }

    function decode_latin1(bs) {
	var encoded = [];
	for (var i = 0; i < bs.length; i++) {
	    encoded.push(String.fromCharCode(bs[i]));
	}
	return encoded.join('');
    }

    function to_hex(bs) {
	var encoded = [];
	for (var i = 0; i < bs.length; i++) {
	    encoded.push("0123456789abcdef"[(bs[i] >> 4) & 15]);
	    encoded.push("0123456789abcdef"[bs[i] & 15]);
	}
	return encoded.join('');
    }

    function from_hex(s) {
        var result = new Uint8Array(s.length / 2);
        for (var i = 0; i < s.length / 2; i++) {
            result[i] = parseInt(s.substr(2*i,2),16);
        }
        return result;
    }

    ///////////////////////////////////////////////////////////////////////////
    // Lacking 64-bit support, we fake it using Int32Arrays, with
    // words in little-endian order.
    // -=-=-=- BEGIN int64array -=-=-=-

    function new_int64array(n) { return new Uint32Array(n * 2); }

    function getlo32(o, i) { return o[(i << 1) + 0]; }
    function gethi32(o, i) { return o[(i << 1) + 1]; }

    function setlo32(o, i, v) { return o[(i << 1) + 0] = v; }
    function sethi32(o, i, v) { return o[(i << 1) + 1] = v; }

    function Word(lo, hi) {
	this.lo = lo >>> 0;
	this.hi = hi >>> 0;
    }

    Word.prototype.extendHi = function (lo, hi) {
	if (typeof hi !== 'undefined') return hi;
	return (lo < 0) ? -1 : 0;
    };

    Word.prototype.zero = function () {
	this.lo = 0;
	this.hi = 0;
    };

    Word.prototype.set = function (other) {
	this.lo = other.lo;
	this.hi = other.hi;
    };

    Word.prototype.load = function (arr, ofs) {
	this.lo = arr[(ofs << 1) + 0];
	this.hi = arr[(ofs << 1) + 1];
    };

    Word.prototype.store = function (arr, ofs) {
	arr[(ofs << 1) + 0] = this.lo;
	arr[(ofs << 1) + 1] = this.hi;
    };

    Word.prototype.addi = function (lo, hi) {
	hi = this.extendHi(lo, hi);
	var oldlo = this.lo >>> 0;
	this.lo = (this.lo + (lo >>> 0)) >>> 0;
	var carry = (this.lo < oldlo) ? 1 : 0;
	this.hi = (this.hi + (hi >>> 0) + carry) >>> 0;
    };

    Word.prototype.add = function (w) {
	this.addi(w.lo, w.hi);
    };

    Word.prototype.add_load = function (arr, ofs) {
	this.addi(arr[(ofs << 1) + 0], arr[(ofs << 1) + 1]);
    };

    Word.prototype.subi = function (lo, hi) {
	hi = this.extendHi(lo, hi);
	var oldlo = this.lo >>> 0;
	this.lo = (this.lo - (lo >>> 0)) >>> 0;
	var carry = (this.lo > oldlo) ? -1 : 0;
	this.hi = (this.hi - (hi >>> 0) + carry) >>> 0;
    };

    Word.prototype.sub = function (w) {
	this.subi(w.lo, w.hi);
    };

    Word.prototype.sub_load = function (arr, ofs) {
	this.subi(arr[(ofs << 1) + 0], arr[(ofs << 1) + 1]);
    };

    Word.prototype.muli = function (bl, bh) {
	var a0 = this.lo & 0xFFFF
	var a1 = this.lo >>> 16 & 0xFFFF;
	var a2 = this.hi & 0xFFFF
	var a3 = this.hi >>> 16 & 0xFFFF;

	bh = this.extendHi(bl, bh);
	var b0 = bl & 0xFFFF
	var b1 = bl >>> 16 & 0xFFFF;
	var b2 = bh & 0xFFFF
	var b3 = bh >>> 16 & 0xFFFF;

	var v00 = a0 * b0;

	var v10 = a1 * b0;
	var v01 = a0 * b1;

	var v20 = a2 * b0;
	var v11 = a1 * b1;
	var v02 = a0 * b2;

	var v30 = a3 * b0;
	var v21 = a2 * b1;
	var v12 = a1 * b2;
	var v03 = a0 * b3;

	var r0 = v00;
	var r1 = v10 + v01 + ((r0 / 65536) >>> 0);
	var r2 = v20 + v11 + v02 + ((r1 / 65536) >>> 0);
	var r3 = v30 + v21 + v12 + v03 + ((r2 / 65536) >>> 0);

	this.lo = (((r0 & 0xffff) | (r1 << 16)) >>> 0) >>> 0;
	this.hi = ((r2 & 0xffff) | (r3 << 16) >>> 0) >>> 0;
    };

    Word.prototype.mul = function (w) {
	this.muli(w.lo, w.hi);
    };

    Word.prototype.mul_load = function (arr, ofs) {
	this.muli(arr[(ofs << 1) + 0], arr[(ofs << 1) + 1]);
    };

    Word.prototype.shli = function (imm) {
	if (!imm) return;
	this.hi = ((this.hi << imm) | (this.lo >>> (32 - imm))) >>> 0;
	this.lo = (this.lo << imm) >>> 0;
    };

    Word.prototype.sari = function (imm) {
	if (!imm) return;
	this.lo = ((this.hi << (32 - imm)) | (this.lo >>> imm)) >>> 0;
	this.hi = (this.hi >> imm) >>> 0;
    };

    Word.prototype.xori = function (lo, hi) {
	hi = this.extendHi(lo, hi);
	this.lo = (this.lo ^ (lo >>> 0)) >>> 0;
	this.hi = (this.hi ^ (hi >>> 0)) >>> 0;
    };

    Word.prototype.xor = function (w) {
	this.xori(w.lo, w.hi);
    };

    Word.prototype.xor_load = function (arr, ofs) {
	this.xori(arr[(ofs << 1) + 0], arr[(ofs << 1) + 1]);
    };

    Word.prototype.rori = function (imm) {
	if (!imm) return;
	var newlo = ((this.hi << (32 - imm)) | (this.lo >>> imm)) >>> 0;
	var newhi = ((this.lo << (32 - imm)) | (this.hi >>> imm)) >>> 0;
	this.lo = newlo;
	this.hi = newhi;
    };

    // -=-=-=- END int64array -=-=-=-
    ///////////////////////////////////////////////////////////////////////////

    function new_gf(vs) {
	var g = new_int64array(16);
	for (var i = 0; i < vs.length; i++) {
	    g[i << 1] = vs[i];
	}
	return g;
    }

    function copy_gf(o) {
	var g = new_int64array(16);
	g.set(o.subarray(0, 32));
	return g;
    }

    var _0 = new Uint8Array(16);
    var _9 = new Uint8Array(32); _9[0] = 9;

    var gf0 = new_gf([]);
    var gf1 = new_gf([1]);
    var _121665 = new_gf([0xDB41, 1]);
    var D = new_gf([0x78a3, 0x1359, 0x4dca, 0x75eb, 0xd8ab, 0x4141, 0x0a4d, 0x0070, 0xe898, 0x7779, 0x4079, 0x8cc7, 0xfe73, 0x2b6f, 0x6cee, 0x5203]);
    var D2 = new_gf([0xf159, 0x26b2, 0x9b94, 0xebd6, 0xb156, 0x8283, 0x149a, 0x00e0, 0xd130, 0xeef3, 0x80f2, 0x198e, 0xfce7, 0x56df, 0xd9dc, 0x2406]);
    var X = new_gf([0xd51a, 0x8f25, 0x2d60, 0xc956, 0xa7b2, 0x9525, 0xc760, 0x692c, 0xdc5c, 0xfdd6, 0xe231, 0xc0a4, 0x53fe, 0xcd6e, 0x36d3, 0x2169]);
    var Y = new_gf([0x6658, 0x6666, 0x6666, 0x6666, 0x6666, 0x6666, 0x6666, 0x6666, 0x6666, 0x6666, 0x6666, 0x6666, 0x6666, 0x6666, 0x6666, 0x6666]);
    var I = new_gf([0xa0b0, 0x4a0e, 0x1b27, 0xc4ee, 0xe478, 0xad2f, 0x1806, 0x2f43, 0xd7a7, 0x3dfb, 0x0099, 0x2b4d, 0xdf0b, 0x4fc1, 0x2480, 0x2b83]);

    ///////////////////////////////////////////////////////////////////////////
    // Constant-time buffer comparison

    /* Constant-time (well, proportional to n) comparison of two Uint8Array buffers */
    /* Returns 0 if they are identical, nonzero otherwise */
    function compare_buffers(x, y, n) {
	var d = 0;
	for (var i = 0; i < n; i++) {
	    d = d | (x[i] ^ y[i]);
	}
	return (1 & ((d - 1) >> 8)) - 1;
    }

    function crypto_verify_16(x, y) { return compare_buffers(x, y, 16); }
    function crypto_verify_32(x, y) { return compare_buffers(x, y, 32); }

    ///////////////////////////////////////////////////////////////////////////
    // Salsa20

    /* Unsigned 32-bit left rotate x by c bits */
    function L32(x, c) { return (((x << c) >>> 0) | ((x&0xffffffff) >>> (32 - c))) >>> 0; }

    /*
      out is the target Uint8Array - 64 bytes if h==0, 32 bytes if h==1
      inbuf is the 16-byte input Uint8Array
      k is the 32-byte Uint8Array key
      c is the 16-byte Uint8Array expansion constant (???)
      h is 1 in order to ???, 0 in order to ???
    */
    function core(out, inbuf, k, c, h) {
	var cView = new Uint32Array(c.buffer);
	var kView = new Uint32Array(k.buffer);
	var inbufView = new Uint32Array(inbuf.buffer);
	var outView = new Uint32Array(out.buffer);

	var w = new Uint32Array(16);
	var x = new Uint32Array(16);
	var y = new Uint32Array(16);
	var t = new Uint32Array(16);

	var i, j, m;

	for (i = 0; i < 4; i++) {
	    x[5*i] = cView[i];
	    x[1+i] = kView[i];
	    x[6+i] = inbufView[i];
	    x[11+i] = kView[i+4];
	}

	for (i = 0; i < 16; i++) {
	    y[i] = x[i];
	}

	for (i = 0; i < 20; i++) {
	    for (j = 0; j < 4; j++) {
		for (m = 0; m < 4; m++) {
		    t[m] = x[(5*j+4*m)%16];
		}
		t[1] ^= L32(t[0]+t[3], 7);
		t[2] ^= L32(t[1]+t[0], 9);
		t[3] ^= L32(t[2]+t[1],13);
		t[0] ^= L32(t[3]+t[2],18);
		for (m = 0; m < 4; m++) {
		    w[4*j+(j+m)%4] = t[m];
		}
	    }
	    for (m = 0; m < 16; m++) {
		x[m] = w[m];
	    }
	}

	if (h) {
	    for (i = 0; i < 16; i++) {
		x[i] += y[i];
	    }
	    for (i = 0; i < 4; i++) {
		x[5*i] -= cView[i];
		x[6+i] -= inbufView[i];
	    }
	    for (i = 0; i < 4; i++) {
		outView[i] = x[5*i];
		outView[i+4] = x[6+i];
	    }
	} else {
	    for (i = 0; i < 16; i++) {
		outView[i] = x[i] + y[i];
	    }
	}
    }

    function crypto_core_salsa20(out,inbuf,k,c) {
	core(out,inbuf,k,c,0);
	return 0;
    }

    function crypto_core_hsalsa20(out,inbuf,k,c) {
	core(out,inbuf,k,c,1);
	return 0;
    }

    var sigma = new Uint8Array([0x65, 0x78, 0x70, 0x61, 0x6e, 0x64, 0x20, 0x33,
				0x32, 0x2d, 0x62, 0x79, 0x74, 0x65, 0x20, 0x6b]);
    /* ^ "expand 32-byte k" */

    /* Uint8Array c will hold the ciphertext
       Uint8Array m holds the input message (may be null)
       64-bit unsigned word b is the byte count: the number of bytes in m to encrypt.
       Uint8Array n holds the 8-byte nonce
       Uint8Array k holds the key */
    function crypto_stream_salsa20_xor(c,m,b,n,k) {
	var z = new Uint8Array(16);
	var x = new Uint8Array(64);
	var u, i;
	var offset = 0;

	if (!b) return 0;

	for (i = 0; i < 16; i++) z[i] = 0;
	for (i = 0; i < 8; i++) z[i] = n[i];

	while (b >= 64) {
	    crypto_core_salsa20(x,z,k,sigma);
	    for (i = 0; i < 64; i++) c[i+offset] = (m?m[i+offset]:0) ^ x[i];
	    u = 1;
	    for (i = 8; i < 16; ++i) {
		u += z[i];
		z[i] = u;
		u >>= 8;
	    }
	    b -= 64;
	    offset += 64;
	}

	if (b) {
	    crypto_core_salsa20(x,z,k,sigma);
	    for (i = 0; i < b; i++) c[i+offset] = (m?m[i+offset]:0) ^ x[i];
	}

	return 0;
    }

    function crypto_stream_salsa20(c,d,n,k) {
	return crypto_stream_salsa20_xor(c,0,d,n,k);
    }

    /* Uint8Array c will hold the keystream
       64-bit unsigned word d is the byte count: the number of bytes of keystream to produce
       Uint8Array n holds the 24-byte nonce
       Uint8Array k holds the 32-byte key */
    function crypto_stream(c,d,n,k) {
	var s = new Uint8Array(32);
	crypto_core_hsalsa20(s,n,k,sigma);
	return crypto_stream_salsa20(c,d,n.subarray(16),s);
    }

    /* Uint8Array c will hold the ciphertext
       Uint8Array m holds the input message
       64-bit unsigned word d is the byte count: the number of bytes in m to encrypt
       Uint8Array n holds the 24-byte nonce
       Uint8Array k holds the 32-byte key */
    function crypto_stream_xor(c,m,d,n,k) {
	var s = new Uint8Array(32);
	crypto_core_hsalsa20(s,n,k,sigma);
	return crypto_stream_salsa20_xor(c,m,d,n.subarray(16),s);
    }

    ///////////////////////////////////////////////////////////////////////////
    // Poly1305

    /* Expects two SEVENTEEN-u32 buffers, h and c. Adds c bytewise
       into h, propagating carry. */
    function add1305(h,c)
    {
	var u = 0;
	for (var j = 0; j < 17; j++) {
	    u += (h[j] + c[j]) >>> 0;
	    h[j] = u & 255;
	    u >>>= 8;
	}
    }

    var minusp = new Uint32Array([5, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 252]);

    /* Uint8Array out will hold the 16-byte authenticator
       Uint8Array m holds the input message
       64-bit unsigned word n is the byte count in m
       Uint8Array k holds the 32-byte key */
    function crypto_onetimeauth(out,m,n,k) {
	var x = new Uint32Array(17);
	var r = new Uint32Array(17);
	var h = new Uint32Array(17);
	var c = new Uint32Array(17);
	var g = new Uint32Array(17);
	var s, i, j, u; /* unsigned 32-bit words */
	var offset = 0;

	/* for (j = 0; j < 17; j++) r[j]=h[j]=0; */ // no need: rely on ArrayBuffer ctor behaviour
	for (j = 0; j < 16; j++) r[j]=k[j];
	r[3]&=15;
	r[4]&=252;
	r[7]&=15;
	r[8]&=252;
	r[11]&=15;
	r[12]&=252;
	r[15]&=15;

	while (n > 0) {
	    for (j = 0; j < 17; j++) c[j] = 0;
	    for (j = 0;(j < 16) && (j < n);++j) c[j] = m[j+offset];
	    c[j] = 1;
	    offset += j; n -= j;
	    add1305(h,c);
	    for (i = 0; i < 17; i++) {
		x[i] = 0;
		for (j = 0; j < 17; j++) {
		    x[i] += Math.imul(h[j], ((j <= i) ? r[i - j] : 320 * r[i + 17 - j])) >>> 0;
		}
	    }
	    for (i = 0; i < 17; i++) h[i] = x[i];
	    u = 0;
	    for (j = 0; j < 16; j++) {
		u += h[j];
		h[j] = u & 255;
		u >>>= 8;
	    }
	    u += h[16]; h[16] = u & 3;
	    u = (5 * (u >>> 2)) >>> 0;
	    for (j = 0; j < 16; j++) {
		u += h[j];
		h[j] = u & 255;
		u >>>= 8;
	    }
	    u += h[16]; h[16] = u;
	}

	for (j = 0; j < 17; j++) g[j] = h[j];
	add1305(h,minusp);
	s = (-(h[16] >>> 7)) >>> 0;
	for (j = 0; j < 17; j++) h[j] ^= s & (g[j] ^ h[j]);

	for (j = 0; j < 16; j++) c[j] = k[j + 16];
	c[16] = 0;
	add1305(h,c);
	for (j = 0; j < 16; j++) out[j] = h[j];
	return 0;
    }

    /* Uint8Array h is the authenticator code to check
       Uint8Array m is the message to check
       64-bit word n is the bytes in m to check
       Uint8Array k is the 32-byte key */
    function crypto_onetimeauth_verify(h,m,n,k) {
	var x = new Uint8Array(16);
	crypto_onetimeauth(x,m,n,k);
	return crypto_verify_16(h,x);
    }

    /* Uint8Array c needs to be big enough to hold d bytes
         - the first 16 bytes will be zero
	 - the next 16 will be the authenticator
       Uint8Array m is the plaintext, with 32 bytes of zeros prepended
       64-bit word d is the number of bytes in m to box (must be >= 32)
       Uint8Array n is the 24-byte nonce
       Uint8Array k is the 32-byte key */
    function crypto_secretbox(c,m,d,n,k) {
	if (d < 32) return -1;
	crypto_stream_xor(c,m,d,n,k);
	crypto_onetimeauth(c.subarray(16),c.subarray(32),d - 32,c);
	for (var i = 0; i < 16; i++) c[i] = 0;
	return 0;
    }

    /* Uint8Array m needs to be big enough to hold d bytes
         - the first 32 bytes will be zero
	 - the remaining bytes will be the plaintext
       Uint8Array c must be at least d bytes long, with the first 16 bytes being zeros
       64-bit word d is the number of bytes in c to open (must be >= 32)
       Uint8Array n is the 24-byte nonce
       Uint8Array k is the 32-byte key */
    function crypto_secretbox_open(m,c,d,n,k) {
	var x = new Uint8Array(32);
	if (d < 32) return -1;
	crypto_stream(x,32,n,k);
	if (crypto_onetimeauth_verify(c.subarray(16),c.subarray(32),d - 32,x) != 0) return -1;
	crypto_stream_xor(m,c,d,n,k);
	for (var i = 0; i < 32; i++) m[i] = 0;
	return 0;
    }

    ///////////////////////////////////////////////////////////////////////////
    // curve25519

    function car25519(o) {
	var c = new Word();
	var tmp = new Word();
	for (var i = 0; i < 16; i++) {
	    c.load(o, i);
	    c.addi(1 << 16);
	    c.store(o, i);
	    c.sari(16);
	    if (i < 15) {
		tmp.load(o, i+1);
		tmp.add(c);
		tmp.subi(1);
		tmp.store(o, i+1);
	    } else {
		tmp.set(c);
		tmp.subi(1);
		tmp.muli(38);
		tmp.add_load(o, 0);
		tmp.store(o, 0);
	    }
	    tmp.load(o, i);
	    c.shli(16);
	    tmp.sub(c);
	    tmp.store(o, i);
	}
    }

    /* TODO: b might be better off as a boolean */
    function sel25519(p,q,b) {
	var tlo, thi, i, clo, chi;
	clo = (~(b-1)) >>> 0;
	chi = (clo >>> 31) ? 0xffffffff : 0;
	// dumpbuf("sel25519 p", p);
	// dumpbuf("sel25519 q", q);
	for (i = 0; i < 32; i += 2) {
	    tlo = clo & (p[i+0] ^ q[i+0]);
	    thi = chi & (p[i+1] ^ q[i+1]);
	    p[i+0] ^= tlo;
	    p[i+1] ^= thi;
	    q[i+0] ^= tlo;
	    q[i+1] ^= thi;
	}
    }

    function pack25519(o,n) {
	var i, j, b;
	var m = new_gf([]);
	var t = copy_gf(n);
	var tmp = new Word();

	car25519(t);
	car25519(t);
	car25519(t);
	for (j = 0; j < 2; j++) {
	    tmp.load(t, 0);
	    tmp.subi(0xffed);
	    tmp.store(m, 0);
	    for(i=1;i<15;i++) {
		tmp.load(t, i);
		tmp.subi(0xffff + ((getlo32(m, i-1) >> 16) & 1));
		tmp.store(m, i);
		setlo32(m, i-1, getlo32(m, i-1) & 0xffff);
		sethi32(m, i-1, 0);
	    }

	    tmp.load(t, 15);
	    tmp.subi(0x7fff + ((getlo32(m, 14) >> 16) & 1));
	    tmp.store(m, 15);
	    b = ((getlo32(m, 15) >> 16) & 1);
	    setlo32(m, 14, getlo32(m, 14) & 0xffff);
	    sethi32(m, 14, 0);
	    sel25519(t,m,1-b);
	}
	for (i = 0; i < 16; i++) {
	    o[2*i]=getlo32(t, i)&0xff;
	    o[2*i+1]=getlo32(t, i)>>8;
	}
    }

    function neq25519(a,b) {
	var c = new Uint8Array(32);
	var d = new Uint8Array(32);
	pack25519(c,a);
	pack25519(d,b);
	return crypto_verify_32(c,d);
    }

    function par25519(a) {
	var d = new Uint8Array(32);
	pack25519(d,a);
	return d[0]&1;
    }

    function unpack25519(o,n) {
	var nView = new Uint16Array(n.buffer);
	for (var i = 0; i < 16; i++) {
	    setlo32(o, i, nView[i]);
	    sethi32(o, i, 0);
	}
	setlo32(o, 15, getlo32(o, 15) & 0x7fff);
	sethi32(o, 15, 0);
    }

    function A(o,a,b) {
	var tmp = new Word();
	for (var i = 0; i < 16; i++) {
	    tmp.load(a, i);
	    tmp.add_load(b, i);
	    tmp.store(o, i);
	}
    }

    function Z(o,a,b) {
	var tmp = new Word();
	for (var i = 0; i < 16; i++) {
	    tmp.load(a, i);
	    tmp.sub_load(b, i);
	    tmp.store(o, i);
	}
    }

    function M(o,a,b) {
	var t = new_int64array(31);
	var tmp = new Word();
	var i, j;
	for (i = 0; i < 16; i++) for (j = 0; j < 16; j++) {
	    tmp.load(a, i);
	    tmp.mul_load(b, j);
	    tmp.add_load(t, i+j);
	    tmp.store(t, i+j);
	}
	for (i = 0; i < 15; i++) {
	    tmp.load(t, i+16);
	    tmp.muli(38);
	    tmp.add_load(t, i);
	    tmp.store(t, i);
	}
	for (i = 0; i < 32 /* ! not 16 */; i++) {
	    o[i]=t[i];
	}
	// dumpbuf("o0", o);
	car25519(o);
	car25519(o);
	// dumpbuf("o1", o);
    }

    function S(o,a) {
	M(o,a,a);
    }

    function inv25519(o,i) {
	var c = copy_gf(i);
	var a;
	for(a=253;a>=0;a--) {
	    S(c,c);
	    if(a!=2&&a!=4) M(c,c,i);
	}
	o.set(c);
    }

    function pow2523(o,i) {
	var c = copy_gf(i);
	var a;
	for(a=250;a>=0;a--) {
	    S(c,c);
	    if(a!=1) M(c,c,i);
	}
	o.set(c);
    }

    // function dumpbuf(what, buf) {
    // 	console.log(what + ":", "(" + buf.byteLength + ")", to_hex(new Uint8Array(buf.buffer)));
    // }

    function crypto_scalarmult(q,n,p) {
	var z = new Uint8Array(32);
	var x = new_int64array(80);
	var i, r;
	var a = new_gf([]);
	var c = new_gf([]);
	var d = new_gf([]);
	var e = new_gf([]);
	var f = new_gf([]);
	z.set(n);
	z[31]=(n[31]&127)|64;
	z[0]&=248;
	unpack25519(x,p);
	// dumpbuf("x00", x);
	var b = copy_gf(x);
	// dumpbuf("x", x);
	// dumpbuf("b", b);
	setlo32(a, 0, 1);
	setlo32(d, 0, 1);
	for(i=254;i>=0;--i) {
	    // if (i == 254) dumpbuf("a0", a);
	    r=(z[i>>3]>>(i&7))&1;
	    sel25519(a,b,r);
	    // if (i == 254) dumpbuf("a1", a);
	    sel25519(c,d,r);
	    A(e,a,c);
	    Z(a,a,c);
	    // if (i == 254) dumpbuf("a2", a);
	    A(c,b,d);
	    Z(b,b,d);
	    S(d,e);
	    S(f,a);
	    // if (i == 254) dumpbuf("a2.5", a);
	    M(a,c,a);
	    // if (i == 254) dumpbuf("a3", a);
	    M(c,b,e);
	    A(e,a,c);
	    Z(a,a,c);
	    // if (i == 254) dumpbuf("a4", a);
	    S(b,a);
	    Z(c,d,f);
	    M(a,c,_121665);
	    // if (i == 254) dumpbuf("a5", a);
	    A(a,a,d);
	    // if (i == 254) dumpbuf("a6", a);
	    M(c,c,a);
	    M(a,d,f);
	    // if (i == 254) dumpbuf("a7", a);
	    M(d,b,x);
	    S(b,e);
	    sel25519(a,b,r);
	    // if (i == 254) dumpbuf("a8", a);
	    sel25519(c,d,r);
	    // if (i == 254) dumpbuf("a9", a);
	}
	x.set(a, 32);
	x.set(c, 64);
	x.set(b, 96);
	x.set(d, 128);
	inv25519(x.subarray(64,96),x.subarray(64,96));
	M(x.subarray(32,64),x.subarray(32,64),x.subarray(64,96));
	pack25519(q,x.subarray(32,64));
	return 0;
    }

    function crypto_scalarmult_base(q,n) {
	return crypto_scalarmult(q,n,_9);
    }

    function crypto_box_keypair(y,x) {
	randombytes_fill(x);
	return crypto_scalarmult_base(y,x);
    }

    function crypto_box_beforenm(k,y,x) {
	var s = new Uint8Array(32);
	crypto_scalarmult(s,x,y);
	return crypto_core_hsalsa20(k,_0,s,sigma);
    }

    function crypto_box_afternm(c,m,d,n,k) {
	return crypto_secretbox(c,m,d,n,k);
    }

    function crypto_box_open_afternm(m,c,d,n,k) {
	return crypto_secretbox_open(m,c,d,n,k);
    }

    function crypto_box(c,m,d,n,y,x) {
	var k = new Uint8Array(32);
	crypto_box_beforenm(k,y,x);
	return crypto_box_afternm(c,m,d,n,k);
    }

    function crypto_box_open(m,c,d,n,y,x) {
	var k = new Uint8Array(32);
	crypto_box_beforenm(k,y,x);
	return crypto_box_open_afternm(m,c,d,n,k);
    }

    ///////////////////////////////////////////////////////////////////////////

/*

static u64 R(u64 x,int c) { return (x >> c) | (x << (64 - c)); }
static u64 Ch(u64 x,u64 y,u64 z) { return (x & y) ^ (~x & z); }
static u64 Maj(u64 x,u64 y,u64 z) { return (x & y) ^ (x & z) ^ (y & z); }
static u64 Sigma0(u64 x) { return R(x,28) ^ R(x,34) ^ R(x,39); }
static u64 Sigma1(u64 x) { return R(x,14) ^ R(x,18) ^ R(x,41); }
static u64 sigma0(u64 x) { return R(x, 1) ^ R(x, 8) ^ (x >> 7); }
static u64 sigma1(u64 x) { return R(x,19) ^ R(x,61) ^ (x >> 6); }

static const u64 K[80] = 
{
  0x428a2f98d728ae22ULL, 0x7137449123ef65cdULL, 0xb5c0fbcfec4d3b2fULL, 0xe9b5dba58189dbbcULL,
  0x3956c25bf348b538ULL, 0x59f111f1b605d019ULL, 0x923f82a4af194f9bULL, 0xab1c5ed5da6d8118ULL,
  0xd807aa98a3030242ULL, 0x12835b0145706fbeULL, 0x243185be4ee4b28cULL, 0x550c7dc3d5ffb4e2ULL,
  0x72be5d74f27b896fULL, 0x80deb1fe3b1696b1ULL, 0x9bdc06a725c71235ULL, 0xc19bf174cf692694ULL,
  0xe49b69c19ef14ad2ULL, 0xefbe4786384f25e3ULL, 0x0fc19dc68b8cd5b5ULL, 0x240ca1cc77ac9c65ULL,
  0x2de92c6f592b0275ULL, 0x4a7484aa6ea6e483ULL, 0x5cb0a9dcbd41fbd4ULL, 0x76f988da831153b5ULL,
  0x983e5152ee66dfabULL, 0xa831c66d2db43210ULL, 0xb00327c898fb213fULL, 0xbf597fc7beef0ee4ULL,
  0xc6e00bf33da88fc2ULL, 0xd5a79147930aa725ULL, 0x06ca6351e003826fULL, 0x142929670a0e6e70ULL,
  0x27b70a8546d22ffcULL, 0x2e1b21385c26c926ULL, 0x4d2c6dfc5ac42aedULL, 0x53380d139d95b3dfULL,
  0x650a73548baf63deULL, 0x766a0abb3c77b2a8ULL, 0x81c2c92e47edaee6ULL, 0x92722c851482353bULL,
  0xa2bfe8a14cf10364ULL, 0xa81a664bbc423001ULL, 0xc24b8b70d0f89791ULL, 0xc76c51a30654be30ULL,
  0xd192e819d6ef5218ULL, 0xd69906245565a910ULL, 0xf40e35855771202aULL, 0x106aa07032bbd1b8ULL,
  0x19a4c116b8d2d0c8ULL, 0x1e376c085141ab53ULL, 0x2748774cdf8eeb99ULL, 0x34b0bcb5e19b48a8ULL,
  0x391c0cb3c5c95a63ULL, 0x4ed8aa4ae3418acbULL, 0x5b9cca4f7763e373ULL, 0x682e6ff3d6b2b8a3ULL,
  0x748f82ee5defb2fcULL, 0x78a5636f43172f60ULL, 0x84c87814a1f0ab72ULL, 0x8cc702081a6439ecULL,
  0x90befffa23631e28ULL, 0xa4506cebde82bde9ULL, 0xbef9a3f7b2c67915ULL, 0xc67178f2e372532bULL,
  0xca273eceea26619cULL, 0xd186b8c721c0c207ULL, 0xeada7dd6cde0eb1eULL, 0xf57d4f7fee6ed178ULL,
  0x06f067aa72176fbaULL, 0x0a637dc5a2c898a6ULL, 0x113f9804bef90daeULL, 0x1b710b35131c471bULL,
  0x28db77f523047d84ULL, 0x32caab7b40c72493ULL, 0x3c9ebe0a15c9bebcULL, 0x431d67c49c100d4cULL,
  0x4cc5d4becb3e42b6ULL, 0x597f299cfc657e2aULL, 0x5fcb6fab3ad6faecULL, 0x6c44198c4a475817ULL
};

// Loads a BIG-ENDIAN 64-bit UNSIGNED word from the given pointer
static u64 dl64(const u8 *x);

// Stores a BIG-ENDIAN 64-bit UNSIGNED word to the given pointer
static void ts64(u8 *x,u64 u);

int crypto_hashblocks(u8 *x,const u8 *m,u64 n)
{
  u64 z[8],b[8],a[8],w[16],t;
  int i,j;

    for (i = 0; i < 8; i++) z[i] = a[i] = dl64(x + 8 * i);

  while (n >= 128) {
      for (i = 0; i < 16; i++) w[i] = dl64(m + 8 * i);

      for (i = 0; i < 80; i++) {
	  for (j = 0; j < 8; j++) b[j] = a[j];
      t = a[7] + Sigma1(a[4]) + Ch(a[4],a[5],a[6]) + K[i] + w[i%16];
      b[7] = t + Sigma0(a[0]) + Maj(a[0],a[1],a[2]);
      b[3] += t;
	  for (j = 0; j < 8; j++) a[(j+1)%8] = b[j];
      if (i%16 == 15)
	  for (j = 0; j < 16; j++)
	  w[j] += w[(j+9)%16] + sigma0(w[(j+1)%16]) + sigma1(w[(j+14)%16]);
    }

      for (i = 0; i < 8; i++) { a[i] += z[i]; z[i] = a[i]; }

    m += 128;
    n -= 128;
  }

    for (i = 0; i < 8; i++) ts64(x+8*i,z[i]);

  return n;
}

static const u8 iv[64] = {
  0x6a,0x09,0xe6,0x67,0xf3,0xbc,0xc9,0x08,
  0xbb,0x67,0xae,0x85,0x84,0xca,0xa7,0x3b,
  0x3c,0x6e,0xf3,0x72,0xfe,0x94,0xf8,0x2b,
  0xa5,0x4f,0xf5,0x3a,0x5f,0x1d,0x36,0xf1,
  0x51,0x0e,0x52,0x7f,0xad,0xe6,0x82,0xd1,
  0x9b,0x05,0x68,0x8c,0x2b,0x3e,0x6c,0x1f,
  0x1f,0x83,0xd9,0xab,0xfb,0x41,0xbd,0x6b,
  0x5b,0xe0,0xcd,0x19,0x13,0x7e,0x21,0x79
} ;

int crypto_hash(u8 *out,const u8 *m,u64 n)
{
  u8 h[64],x[256];
  u64 i,b = n;

    for (i = 0; i < 64; i++) h[i] = iv[i];

  crypto_hashblocks(h,m,n);
  m += n;
  n &= 127;
  m -= n;

    for (i = 0; i < 256; i++) x[i] = 0;
    for (i = 0; i < n; i++) x[i] = m[i];
  x[n] = 128;

  n = 256-128*(n<112);
  x[n-9] = b >> 61;
  ts64(x+n-8,b<<3);
  crypto_hashblocks(h,x,n);

    for (i = 0; i < 64; i++) out[i] = h[i];

  return 0;
}

static void add(gf p[4],gf q[4])
{
  gf a,b,c,d,t,e,f,g,h;
  
  Z(a, p[1], p[0]);
  Z(t, q[1], q[0]);
  M(a, a, t);
  A(b, p[0], p[1]);
  A(t, q[0], q[1]);
  M(b, b, t);
  M(c, p[3], q[3]);
  M(c, c, D2);
  M(d, p[2], q[2]);
  A(d, d, d);
  Z(e, b, a);
  Z(f, d, c);
  A(g, d, c);
  A(h, b, a);

  M(p[0], e, f);
  M(p[1], h, g);
  M(p[2], g, f);
  M(p[3], e, h);
}

static void cswap(gf p[4],gf q[4],u8 b)
{
  int i;
    for (i = 0; i < 4; i++)
    sel25519(p[i],q[i],b);
}

static void pack(u8 *r,gf p[4])
{
  gf tx, ty, zi;
  inv25519(zi, p[2]); 
  M(tx, p[0], zi);
  M(ty, p[1], zi);
  pack25519(r, ty);
  r[31] ^= par25519(tx) << 7;
}

static void scalarmult(gf p[4],gf q[4],const u8 *s)
{
  int i;
    p[0].set(gf0);
    p[1].set(gf1);
    p[2].set(gf1);
    p[3].set(gf0);
  for (i = 255;i >= 0;--i) {
    u8 b = (s[i/8]>>(i&7))&1;
    cswap(p,q,b);
    add(q,p);
    add(p,p);
    cswap(p,q,b);
  }
}

static void scalarbase(gf p[4],const u8 *s)
{
  gf q[4];
    q[0].set(X);
    q[1].set(Y);
    q[2].set(gf1);
  M(q[3],X,Y);
  scalarmult(p,q,s);
}

int crypto_sign_keypair(u8 *pk, u8 *sk)
{
  u8 d[64];
  gf p[4];
  int i;

  randombytes(sk, 32);
  crypto_hash(d, sk, 32);
  d[0] &= 248;
  d[31] &= 127;
  d[31] |= 64;

  scalarbase(p,d);
  pack(pk,p);

    for (i = 0; i < 32; i++) sk[32 + i] = pk[i];
  return 0;
}

static const u64 L[32] = {0xed, 0xd3, 0xf5, 0x5c, 0x1a, 0x63, 0x12, 0x58, 0xd6, 0x9c, 0xf7, 0xa2, 0xde, 0xf9, 0xde, 0x14, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0x10};

static void modL(u8 *r,i64 x[64])
{
  i64 carry,i,j;
  for (i = 63;i >= 32;--i) {
    carry = 0;
    for (j = i - 32;j < i - 12;++j) {
      x[j] += carry - 16 * x[i] * L[j - (i - 32)];
      carry = (x[j] + 128) >> 8;
      x[j] -= carry << 8;
    }
    x[j] += carry;
    x[i] = 0;
  }
  carry = 0;
    for (j = 0; j < 32; j++) {
    x[j] += carry - (x[31] >> 4) * L[j];
    carry = x[j] >> 8;
    x[j] &= 255;
  }
    for (j = 0; j < 32; j++) x[j] -= carry * L[j];
    for (i = 0; i < 32; i++) {
    x[i+1] += x[i] >> 8;
    r[i] = x[i] & 255;
  }
}

static void reduce(u8 *r)
{
  i64 x[64],i;
    for (i = 0; i < 64; i++) x[i] = (u64) r[i];
    for (i = 0; i < 64; i++) r[i] = 0;
  modL(r,x);
}

int crypto_sign(u8 *sm,u64 *smlen,const u8 *m,u64 n,const u8 *sk)
{
  u8 d[64],h[64],r[64];
  i64 i,j,x[64];
  gf p[4];

  crypto_hash(d, sk, 32);
  d[0] &= 248;
  d[31] &= 127;
  d[31] |= 64;

  *smlen = n+64;
    for (i = 0; i < n; i++) sm[64 + i] = m[i];
    for (i = 0; i < 32; i++) sm[32 + i] = d[32 + i];

  crypto_hash(r, sm+32, n+32);
  reduce(r);
  scalarbase(p,r);
  pack(sm,p);

    for (i = 0; i < 32; i++) sm[i+32] = sk[i+32];
  crypto_hash(h,sm,n + 64);
  reduce(h);

    for (i = 0; i < 64; i++) x[i] = 0;
    for (i = 0; i < 32; i++) x[i] = (u64) r[i];
    for (i = 0; i < 32; i++) for (j = 0; j < 32; j++) x[i+j] += h[i] * (u64) d[j];
  modL(sm + 32,x);

  return 0;
}

static int unpackneg(gf r[4],const u8 p[32])
{
  gf t, chk, num, den, den2, den4, den6;
    r[2].set(gf1);
  unpack25519(r[1],p);
  S(num,r[1]);
  M(den,num,D);
  Z(num,num,r[2]);
  A(den,r[2],den);

  S(den2,den);
  S(den4,den2);
  M(den6,den4,den2);
  M(t,den6,num);
  M(t,t,den);

  pow2523(t,t);
  M(t,t,num);
  M(t,t,den);
  M(t,t,den);
  M(r[0],t,den);

  S(chk,r[0]);
  M(chk,chk,den);
  if (neq25519(chk, num)) M(r[0],r[0],I);

  S(chk,r[0]);
  M(chk,chk,den);
  if (neq25519(chk, num)) return -1;

  if (par25519(r[0]) == (p[31]>>7)) Z(r[0],gf0,r[0]);

  M(r[3],r[0],r[1]);
  return 0;
}

int crypto_sign_open(u8 *m,u64 *mlen,const u8 *sm,u64 n,const u8 *pk)
{
  int i;
  u8 t[32],h[64];
  gf p[4],q[4];

  *mlen = -1;
  if (n < 64) return -1;

  if (unpackneg(q,pk)) return -1;

    for (i = 0; i < n; i++) m[i] = sm[i];
    for (i = 0; i < 32; i++) m[i+32] = pk[i];
  crypto_hash(h,m,n);
  reduce(h);
  scalarmult(p,q,h);

  scalarbase(q,sm + 32);
  add(p,q);
  pack(t,p);

  n -= 64;
  if (crypto_verify_32(sm, t)) {
      for (i = 0; i < n; i++) m[i] = 0;
    return -1;
  }

    for (i = 0; i < n; i++) m[i] = sm[i + 64];
  *mlen = n;
  return 0;
}

*/

    return {
	encode_utf8: encode_utf8,
	encode_latin1: encode_latin1,
	decode_utf8: decode_utf8,
	decode_latin1: decode_latin1,
	to_hex: to_hex,
	from_hex: from_hex,

	crypto_verify_16: crypto_verify_16,
	crypto_verify_32: crypto_verify_32,
	crypto_stream: crypto_stream,
	crypto_stream_xor: crypto_stream_xor,
	crypto_onetimeauth: crypto_onetimeauth,
	crypto_onetimeauth_verify: crypto_onetimeauth_verify,
	crypto_secretbox: crypto_secretbox,
	crypto_secretbox_open: crypto_secretbox_open,
	crypto_scalarmult: crypto_scalarmult,
	crypto_scalarmult_base: crypto_scalarmult_base,
	crypto_box_keypair: crypto_box_keypair,
	crypto_box_beforenm: crypto_box_beforenm,
	crypto_box_afternm: crypto_box_afternm,
	crypto_box_open_afternm: crypto_box_open_afternm,
	crypto_box: crypto_box,
	crypto_box_open: crypto_box_open,

	constants: {
	    crypto_auth_PRIMITIVE: "hmacsha512256",
	    crypto_auth_BYTES: 32,
	    crypto_auth_KEYBYTES: 32,
	    crypto_auth_VERSION: "-",
	    crypto_auth_IMPLEMENTATION: "crypto_auth/hmacsha512256/tweetjs",

	    crypto_box_PRIMITIVE: "curve25519xsalsa20poly1305",
	    crypto_box_PUBLICKEYBYTES: 32,
	    crypto_box_SECRETKEYBYTES: 32,
	    crypto_box_BEFORENMBYTES: 32,
	    crypto_box_NONCEBYTES: 24,
	    crypto_box_ZEROBYTES: 32,
	    crypto_box_BOXZEROBYTES: 16,
	    crypto_box_VERSION: "-",
	    crypto_box_IMPLEMENTATION: "crypto_box/curve25519xsalsa20poly1305/tweetjs",

	    crypto_core_PRIMITIVE: "salsa20",
	    crypto_core_OUTPUTBYTES: 64,
	    crypto_core_INPUTBYTES: 16,
	    crypto_core_KEYBYTES: 32,
	    crypto_core_CONSTBYTES: 16,
	    crypto_core_VERSION: "-",
	    crypto_core_IMPLEMENTATION: "crypto_core/salsa20/tweetjs",

	    crypto_hashblocks_PRIMITIVE: "sha512",
	    crypto_hashblocks_STATEBYTES: 64,
	    crypto_hashblocks_BLOCKBYTES: 128,
	    crypto_hashblocks_VERSION: "-",
	    crypto_hashblocks_IMPLEMENTATION: "crypto_hashblocks/sha512/tweetjs",

	    crypto_hash_PRIMITIVE: "sha512",
	    crypto_hash_BYTES: 64,
	    crypto_hash_VERSION: "-",
	    crypto_hash_IMPLEMENTATION: "crypto_hash/sha512/tweetjs",

	    crypto_onetimeauth_PRIMITIVE: "poly1305",
	    crypto_onetimeauth_BYTES: 16,
	    crypto_onetimeauth_KEYBYTES: 32,
	    crypto_onetimeauth_VERSION: "-",
	    crypto_onetimeauth_IMPLEMENTATION: "crypto_onetimeauth/poly1305/tweetjs",

	    crypto_scalarmult_PRIMITIVE: "curve25519",
	    crypto_scalarmult_BYTES: 32,
	    crypto_scalarmult_SCALARBYTES: 32,
	    crypto_scalarmult_VERSION: "-",
	    crypto_scalarmult_IMPLEMENTATION: "crypto_scalarmult/curve25519/tweetjs",

	    crypto_secretbox_PRIMITIVE: "xsalsa20poly1305",
	    crypto_secretbox_KEYBYTES: 32,
	    crypto_secretbox_NONCEBYTES: 24,
	    crypto_secretbox_ZEROBYTES: 32,
	    crypto_secretbox_BOXZEROBYTES: 16,
	    crypto_secretbox_VERSION: "-",
	    crypto_secretbox_IMPLEMENTATION: "crypto_secretbox/xsalsa20poly1305/tweetjs",

	    crypto_sign_PRIMITIVE: "ed25519",
	    crypto_sign_BYTES: 64,
	    crypto_sign_PUBLICKEYBYTES: 32,
	    crypto_sign_SECRETKEYBYTES: 64,
	    crypto_sign_VERSION: "-",
	    crypto_sign_IMPLEMENTATION: "crypto_sign/ed25519/tweetjs",

	    crypto_stream_PRIMITIVE: "xsalsa20",
	    crypto_stream_KEYBYTES: 32,
	    crypto_stream_NONCEBYTES: 24,
	    crypto_stream_VERSION: "-",
	    crypto_stream_IMPLEMENTATION: "crypto_stream/xsalsa20/tweetjs"
	}
    };
}

function TweetNacl() {
    var nacl_raw = TweetNaclC();
    var C = nacl_raw.constants;

    var NodeJsBuffer;
    if (typeof module !== 'undefined' && module.exports) {
	NodeJsBuffer = Buffer;
    } else {
	NodeJsBuffer = function dummy() {};
    }

    function coerce_u8(thing) {
	if (thing instanceof NodeJsBuffer) {
	    thing = new Uint8Array(thing);
	}
	if (!(thing instanceof Uint8Array)) {
	    thing = new Uint8Array(thing.buffer);
	}
	return thing;
    }

    function prepend_u8(thing, prefixlen) {
	var result;
	if (thing instanceof NodeJsBuffer) {
	    result = new Uint8Array(thing.length + prefixlen);
	    result.set(thing, prefixlen);
	} else {
	    if (!(thing instanceof Uint8Array)) {
		thing = new Uint8Array(thing.buffer);
	    }
	    result = new Uint8Array(thing.byteLength + prefixlen);
	    result.set(thing, prefixlen);
	}
	return result;
    }

    function check_length(function_name, what, thing, expected_length) {
	thing = coerce_u8(thing);
	if (thing.byteLength !== expected_length) {
	    throw { name: "Invalid " + what + " length",
		    message: function_name + " expected binary " + what + " input of length "
		             + expected + " but got length " + thing.byteLength,
		    expected: expected_length,
		    actual: thing.byteLength };
	}
	return thing;
    }

    function check(function_name, result) {
	if (result !== 0) {
	    throw {message: "nacl_raw." + function_name + " signalled an error"};
	}
    }

    function random_bytes(n) {
	var b = new Uint8Array(n);
	nacl_raw.randombytes_fill(b);
	return b;
    }

    var exports = {
	_raw: nacl_raw,

	random_bytes: random_bytes,

	///////////////////////////////////////////////////////////////////////////

	crypto_stream_random_nonce: function () {
	    return random_bytes(C.crypto_stream_NONCEBYTES);
	},

	crypto_stream_random_key: function () {
	    return random_bytes(C.crypto_stream_KEYBYTES);
	},

	crypto_stream: function (len, nonce, key) {
	    var na = check_length("crypto_stream", "nonce", nonce, C.crypto_stream_NONCEBYTES);
	    var ka = check_length("crypto_stream", "key", key, C.crypto_stream_KEYBYTES);
	    var out = new Uint8Array(len);
	    check("crypto_stream", nacl_raw.crypto_stream(out, len, na, ka));
	    return out;
	},

	crypto_stream_xor: function (msg, nonce, key) {
	    var na = check_length("crypto_stream_xor", "nonce", nonce, C.crypto_stream_NONCEBYTES);
	    var ka = check_length("crypto_stream_xor", "key", key, C.crypto_stream_KEYBYTES);
	    var ma = coerce_u8(msg);
	    var out = new Uint8Array(msg.byteLength);
	    check("crypto_stream_xor", nacl_raw.crypto_stream_xor(out, ma, msg.byteLength, na, ka));
	    return out;
	},

	///////////////////////////////////////////////////////////////////////////

	crypto_onetimeauth: function (msg, key) {
	    var ka = check_length("crypto_onetimeauth", "key", key, C.crypto_onetimeauth_KEYBYTES);
	    var ma = coerce_u8(msg);
	    var authenticator = new Uint8Array(C.crypto_onetimeauth_BYTES);
	    check("crypto_onetimeauth",
		  nacl_raw.crypto_onetimeauth(authenticator, ma, ma.byteLength, ka));
	    return authenticator;
	},

	crypto_onetimeauth_verify: function (authenticator, msg, key) {
	    if (authenticator.length != C.crypto_onetimeauth_BYTES) return false;
	    var ka = check_length("crypto_onetimeauth_verify", "key", key,
				  C.crypto_onetimeauth_KEYBYTES);
	    var ma = coerce_u8(msg);
	    var aa = coerce_u8(authenticator);
	    var result = nacl_raw.crypto_onetimeauth_verify(aa, ma, ma.byteLength, ka);
	    return (result == 0);
	},

	///////////////////////////////////////////////////////////////////////////

	crypto_secretbox_random_nonce: function () {
	    return random_bytes(C.crypto_secretbox_NONCEBYTES);
	},

	crypto_secretbox_random_key: function () {
	    return random_bytes(C.crypto_secretbox_KEYBYTES);
	},

	crypto_secretbox: function (msg, nonce, key) {
	    var m = prepend_u8(msg, C.crypto_secretbox_ZEROBYTES);
	    var na = check_length("crypto_secretbox", "nonce", nonce,
				  C.crypto_secretbox_NONCEBYTES);
	    var ka = check_length("crypto_secretbox", "key", key, C.crypto_secretbox_KEYBYTES);
	    var c = new Uint8Array(m.byteLength);
	    check("crypto_secretbox", nacl_raw.crypto_secretbox(c, m, c.byteLength, na, ka));
	    return c.subarray(C.crypto_secretbox_BOXZEROBYTES);
	},

	crypto_secretbox_open: function (ciphertext, nonce, key) {
	    var c = prepend_u8(ciphertext, C.crypto_secretbox_BOXZEROBYTES);
	    var na = check_length("crypto_secretbox_open", "nonce", nonce,
				  C.crypto_secretbox_NONCEBYTES);
	    var ka = check_length("crypto_secretbox_open", "key", key, C.crypto_secretbox_KEYBYTES);
	    var m = new Uint8Array(c.byteLength);
	    check("crypto_secretbox_open",
		  nacl_raw.crypto_secretbox_open(m, c, m.byteLength, na, ka));
	    return m.subarray(C.crypto_secretbox_ZEROBYTES);
	},

	///////////////////////////////////////////////////////////////////////////

	crypto_scalarmult: function (n,p) {
	    var na = check_length("crypto_scalarmult", "n", n, C.crypto_scalarmult_SCALARBYTES);
	    var pa = check_length("crypto_scalarmult", "p", p, C.crypto_scalarmult_BYTES);
            var q = new Uint8Array(C.crypto_scalarmult_BYTES);
            check("crypto_scalarmult", nacl_raw.crypto_scalarmult(q, na, pa));
            return q;
	},

	crypto_scalarmult_base: function (n) {
	    var na = check_length("crypto_scalarmult_base", "n", n,
				  C.crypto_scalarmult_SCALARBYTES);
            var q = new Uint8Array(C.crypto_scalarmult_BYTES);
            check("crypto_scalarmult_base", nacl_raw.crypto_scalarmult_base(q, na));
            return q;
	},

	///////////////////////////////////////////////////////////////////////////

	crypto_box_keypair: function () {
	    var pk = new Uint8Array(C.crypto_box_PUBLICKEYBYTES);
	    var sk = new Uint8Array(C.crypto_box_SECRETKEYBYTES);
	    check("crypto_box_keypair", nacl_raw.crypto_box_keypair(pk, sk));
	    return {boxPk: pk, boxSk: sk};
	},

	crypto_box_random_nonce: function () {
	    return random_bytes(C.crypto_box_NONCEBYTES);
	},

	crypto_box: function (msg, nonce, pk, sk) {
	    var m = prepend_u8(msg, C.crypto_box_ZEROBYTES);
	    var na = check_length("crypto_box", "nonce", nonce, C.crypto_box_NONCEBYTES);
	    var pka = check_length("crypto_box", "pk", pk, C.crypto_box_PUBLICKEYBYTES);
	    var ska = check_length("crypto_box", "sk", sk, C.crypto_box_SECRETKEYBYTES);
	    var c = new Uint8Array(m.byteLength);
	    check("crypto_box", nacl_raw.crypto_box(c, m, c.byteLength, na, pka, ska));
	    return c.subarray(C.crypto_box_BOXZEROBYTES);
	},

	crypto_box_open: function (ciphertext, nonce, pk, sk) {
	    var c = prepend_u8(ciphertext, C.crypto_box_BOXZEROBYTES);
	    var na = check_length("crypto_box_open", "nonce", nonce, C.crypto_box_NONCEBYTES);
	    var pka = check_length("crypto_box_open", "pk", pk, C.crypto_box_PUBLICKEYBYTES);
	    var ska = check_length("crypto_box_open", "sk", sk, C.crypto_box_SECRETKEYBYTES);
	    var m = new Uint8Array(c.byteLength);
	    check("crypto_box_open", nacl_raw.crypto_box_open(m, c, m.byteLength, na, pka, ska));
	    return m.subarray(C.crypto_box_ZEROBYTES);
	},

	crypto_box_precompute: function (pk, sk) {
	    var pka = check_length("crypto_box_precompute", "pk", pk, C.crypto_box_PUBLICKEYBYTES);
	    var ska = check_length("crypto_box_precompute", "sk", sk, C.crypto_box_SECRETKEYBYTES);
	    var k = new Uint8Array(C.crypto_box_BEFORENMBYTES);
	    check("crypto_box_beforenm", nacl_raw.crypto_box_beforenm(k, pka, ska));
	    return {boxK: k};
	},

	crypto_box_precomputed: function (msg, nonce, state) {
	    var m = prepend_u8(msg, C.crypto_box_ZEROBYTES);
	    var na = check_length("crypto_box_precomputed", "nonce", nonce,
				  C.crypto_box_NONCEBYTES);
	    var ka = check_length("crypto_box_precomputed", "boxK", state.boxK,
				  C.crypto_box_BEFORENMBYTES);
	    var c = new Uint8Array(m.byteLength);
	    check("crypto_box_afternm", nacl_raw.crypto_box_afternm(c, m, c.byteLength, na, ka));
	    return c.subarray(C.crypto_box_BOXZEROBYTES);
	},

	crypto_box_open_precomputed: function (ciphertext, nonce, state) {
	    var c = prepend_u8(ciphertext, C.crypto_box_BOXZEROBYTES);
	    var na = check_length("crypto_box_open_precomputed", "nonce", nonce,
				  C.crypto_box_NONCEBYTES);
	    var ka = check_length("crypto_box_open_precomputed", "boxK", state.boxK,
				  C.crypto_box_BEFORENMBYTES);
	    var m = new Uint8Array(c.byteLength);
	    check("crypto_box_open_afternm",
		  nacl_raw.crypto_box_open_afternm(m, c, m.byteLength, na, ka));
	    return m.subarray(C.crypto_box_ZEROBYTES);
	},

	///////////////////////////////////////////////////////////////////////////

/*
    function crypto_sign_keypair_from_seed(bs) {
	var seeda = check_injectBytes("crypto_sign_keypair_from_seed",
				      "seed", bs, nacl_raw._crypto_sign_SECRETKEYBYTES / 2);
	var pk = new Target(nacl_raw._crypto_sign_PUBLICKEYBYTES);
	var sk = new Target(nacl_raw._crypto_sign_SECRETKEYBYTES);
	check("_crypto_sign_keypair_from_raw_sk",
	      nacl_raw._crypto_sign_keypair_from_raw_sk(pk.address, sk.address, seeda));
	FREE(seeda);
	return {signPk: pk.extractBytes(), signSk: sk.extractBytes()};
    }

    function crypto_box_keypair_from_seed(bs) {
	var hash = new Uint8Array(crypto_hash(bs));
	return crypto_box_keypair_from_raw_sk(hash.subarray(0,
							    nacl_raw._crypto_box_SECRETKEYBYTES));
    }
*/

	crypto_box_keypair_from_raw_sk: function (sk) {
	    return {boxPk: exports.crypto_scalarmult_base(sk), boxSk: sk};
	},

	///////////////////////////////////////////////////////////////////////////

	encode_utf8: nacl_raw.encode_utf8,
	encode_latin1: nacl_raw.encode_latin1,
	decode_utf8: nacl_raw.decode_utf8,
	decode_latin1: nacl_raw.decode_latin1,
	to_hex: nacl_raw.to_hex,
	from_hex: nacl_raw.from_hex,

	constants: nacl_raw.constants
    };

    return exports;
}

function testit() {
    var t = TweetNacl();

    var C = t.from_hex('08877931f3041765b847df995236a3c6b799cabe24');
    var N = t.from_hex('000000000000000000000000000000000000000000000000');
    var K = t.from_hex('2bc13f55fb873ba3c5bde13c31db69c69c8067cfc80c92d918d0884981bf72dd');

    var m = t.encode_utf8('hello');

    function expect(what, actual, expected) {
	if (actual !== expected) {
	    console.log("Expected " + what + " to be " + expected + " but got " + actual);
	}
    }

    var c2 = t.crypto_secretbox(m, N, K);
    expect("c2 ciphertext", t.to_hex(c2), t.to_hex(C));

    var m2 = t.crypto_secretbox_open(c2, N, K);
    console.log(t.decode_utf8(m2));
    expect("m2 plaintext", t.to_hex(m2), t.to_hex(m));

    // Check correctness of curve25519 via NaCl test vector
    var alice_private =
	t.from_hex("77076d0a7318a57d3c16c17251b26645df4c2f87ebc0992ab177fba51db92c2a");
    var bob_public =
	t.from_hex("de9edb7d7b7dc1b4d35b61c2ece435373f8343c85b78674dadfc7e146f882b4f");
    expect("scalarmult alice bob",
	   t.to_hex(t.crypto_scalarmult(alice_private, bob_public)),
	   "4a5d9d5ba4ce2de1728e3bf480350f25e07e21c947d19e3376f09b3c1e161742");

    var helloHash = t.from_hex("9b71d224bd62f3785d96d46ad3ea3d73319bfbc2890caadae2dff72519673ca72323c3d99ba5c11d7c7acc6e14b8c5da0c4663475c2e5c3adef46f73bcdec043");
    var sk = helloHash.subarray(0, t.constants.crypto_box_SECRETKEYBYTES);
    var kp = t.crypto_box_keypair_from_raw_sk(sk);
    expect("sk", t.to_hex(kp.boxSk),
    	   "9b71d224bd62f3785d96d46ad3ea3d73319bfbc2890caadae2dff72519673ca7");
    expect("pk", t.to_hex(kp.boxPk),
    	   "d8333ecf53dac465d59f3b03878ceff88947eec57c965105a049a0f5f1b7a510");
}

testit();