import core;

int function main() {
    int x = 5;
    int y = 6;
    string hello = "Hello World";
    log(x + y);
    log(hello); 
    int sum = add(x, y);
    log(sum);
    if(sum < 15) {
        log(sum + " is less than 15");
    }else if(sum > 10) {
        log(sum + " is greater than 10");
    }else if(sum > 5) {
        log(sum + " is greater than 5");
    }else{
        log(sum + " is less than 5");
    }
    while(sum < 15) {
        log(sum);
        if(sum < 12) {
            sum++;
            continue;
        }else{
            break;
        }
    }
    for(int i = 0; i < sum; i++) {
        log(i);
        if(i == 10) {
            break;
        }
    }
    if(true || false) {
        log("Always True");
    }
    if(true && false) {
        log("How");
    }else{
        log("Always Runs");
    }
    boolean bool = true;
    while(bool) {
        log("will run once");
        bool = false;
    }
    int z = 2^2;
    log(z);
    int w = x;
    log(w);
    w = x++;
    log(w);
    int h = x++;
    log(h);
    int k = 1++;
    log(k);
    sum = add(add(x, z), y);
    log(sum);
    int n = 2 + add(z, h);
    log(n);
    int t = add(w, n) + 2;
    log(t);
    int q = add(x, y) + add(x, y);
}

int function add(int arg1, int arg2) {
    return arg1 + arg2 + 2;
}
